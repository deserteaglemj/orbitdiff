import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as onboardingPOST } from "@/app/api/me/onboarding/route";
import { describeApiFailure } from "@/components/onboarding/api";
import { buildOnboardingBody, consentToConfirm, describeAgreementRefusal } from "@/components/onboarding/model";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { recordSignupConsent } from "@/server/auth/consent";
import { closeDb, getDb } from "@/server/db/client";
import { auditEvent, consentRecord, user } from "@/server/db/schema";
import { getConsentState } from "@/server/services/consent";

import { createVerifiedUser, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";
import { callRoute } from "../../helpers/http";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";
/** The versions every page rendered before a document changed still holds. */
const SHOWN = { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy };
const BUMPED = "2099-01-01";

type Versions = { terms: string; privacy: string; marketing: string };

/** Run with the server holding other document versions, as after a deploy that changed a document. */
async function withServerVersions<T>(bump: Partial<Versions>, run: () => Promise<T>): Promise<T> {
  const versions = CONSENT_VERSIONS as unknown as Versions;
  const before = { ...versions };
  Object.assign(versions, bump);
  try {
    return await run();
  } finally {
    Object.assign(versions, before);
  }
}

/** Every consent row in the database as kind:version:granted:source, sorted. */
async function consentLog(): Promise<string[]> {
  const rows = await getDb().select().from(consentRecord);
  return rows.map((row) => `${row.kind}:${row.version}:${row.granted}:${row.source}`).sort();
}

async function userCount(): Promise<number> {
  return (await getDb().select({ id: user.id }).from(user)).length;
}

/** Sign up naming the current Terms, with `acceptedPrivacyVersion` set to anything, or left out for undefined. */
function signUpWithPrivacy(value: unknown, extra: Record<string, unknown> = {}): Promise<Response> {
  return signUp({ email: EMAIL, extra: value === undefined ? extra : { ...extra, acceptedPrivacyVersion: value } });
}

async function expectPrivacyRefusal(response: Response): Promise<string> {
  expect(response.status).toBe(422);
  const body = (await response.json()) as { code: string; message: string };
  expect(body.code).toBe("PRIVACY_NOT_ACCEPTED");
  expect(await userCount()).toBe(0);
  expect(await consentLog()).toEqual([]);
  return body.message;
}

describe("sign-up records privacy consent only at a version the request named", () => {
  it("refuses a request that names only the earlier version after the Privacy notice alone changed", async () => {
    await withServerVersions({ privacy: BUMPED }, async () => {
      const message = await expectPrivacyRefusal(
        await signUp({ email: EMAIL, acceptedTermsVersion: SHOWN.terms }),
      );
      expect(message).toBe(
        "acceptedPrivacyVersion is missing, and the version the request names is not the current version of the " +
          "Privacy notice. Reload the page, read the current Privacy notice, and agree again to create an account.",
      );
    });
  });

  it("never writes a privacy row at a version the request did not name", async () => {
    await withServerVersions({ privacy: BUMPED }, async () => {
      await signUp({ email: EMAIL, acceptedTermsVersion: SHOWN.terms });
      expect((await consentLog()).filter((row) => row.includes(BUMPED))).toEqual([]);
    });
  });

  it("refuses the earlier privacy version when the request names it", async () => {
    await withServerVersions({ privacy: BUMPED }, async () => {
      const message = await expectPrivacyRefusal(await signUpWithPrivacy(SHOWN.privacy));
      expect(message).toBe(
        "acceptedPrivacyVersion is not the current version of the Privacy notice. " +
          "Reload the page, read the current Privacy notice, and agree again to create an account.",
      );
    });
  });

  it("refuses the version of the Terms named as the privacy version when the two differ", async () => {
    await withServerVersions({ terms: BUMPED }, async () => {
      await expectPrivacyRefusal(
        await signUp({ email: EMAIL, acceptedTermsVersion: BUMPED, extra: { acceptedPrivacyVersion: BUMPED } }),
      );
    });
  });

  it("refuses an empty privacy version and says it is empty", async () => {
    const message = await expectPrivacyRefusal(await signUpWithPrivacy(""));
    expect(message).toBe(
      "acceptedPrivacyVersion is empty. Accept the Terms and the Privacy notice to create an account.",
    );
  });

  it.each([
    ["a number", 20260930],
    ["true", true],
    ["null", null],
    ["a list", [CONSENT_VERSIONS.privacy]],
    ["an object", { version: CONSENT_VERSIONS.privacy }],
  ])("refuses a privacy version that is %s and says it must be text", async (_label, value) => {
    const message = await expectPrivacyRefusal(await signUpWithPrivacy(value));
    expect(message).toBe(
      "acceptedPrivacyVersion must be text. Send the version of the Privacy notice that was accepted.",
    );
  });

  it("refuses a fabricated privacy version and does not repeat it", async () => {
    const message = await expectPrivacyRefusal(await signUpWithPrivacy("v999-made-up"));
    expect(message).toContain("not the current version of the Privacy notice");
    expect(message).not.toContain("v999-made-up");
  });

  it("refuses an outdated privacy version", async () => {
    const message = await expectPrivacyRefusal(await signUpWithPrivacy("2020-01-01"));
    expect(message).toContain("not the current version of the Privacy notice");
  });

  it.each([
    ["a leading space", ` ${CONSENT_VERSIONS.privacy}`],
    ["a trailing space", `${CONSENT_VERSIONS.privacy} `],
    ["a trailing line break", `${CONSENT_VERSIONS.privacy}\n`],
    ["extra text after it", `${CONSENT_VERSIONS.privacy}-accepted`],
  ])("refuses the current privacy version with %s", async (_label, value) => {
    const message = await expectPrivacyRefusal(await signUpWithPrivacy(value));
    expect(message).toContain("not the current version of the Privacy notice");
  });

  it("does not take agreement to product news as acceptance of a changed Privacy notice", async () => {
    await withServerVersions({ privacy: BUMPED }, async () => {
      await expectPrivacyRefusal(await signUp({ email: EMAIL, marketingOptIn: true }));
    });
  });

  it("leaves an audit row for the refusal that names the code and nothing about the person", async () => {
    await withServerVersions({ privacy: BUMPED }, async () => {
      await signUp({ email: EMAIL });
      const rows = await getDb().select().from(auditEvent);
      expect(rows.map((row) => [row.action, row.detail])).toEqual([
        ["registration_refused", { code: "PRIVACY_NOT_ACCEPTED" }],
      ]);
    });
  });

  it("records both documents at the versions the request named when they differ", async () => {
    await withServerVersions({ privacy: BUMPED }, async () => {
      const response = await signUp({
        email: EMAIL,
        acceptedTermsVersion: SHOWN.terms,
        extra: { acceptedPrivacyVersion: BUMPED },
      });
      expect(response.status).toBe(200);
      expect(await consentLog()).toEqual([
        `marketing:${CONSENT_VERSIONS.marketing}:false:signup`,
        `privacy:${BUMPED}:true:signup`,
        `terms:${SHOWN.terms}:true:signup`,
      ]);
    });
  });

  it("records both documents when the request names each current version", async () => {
    expect((await signUpWithPrivacy(CONSENT_VERSIONS.privacy)).status).toBe(200);
    expect(await consentLog()).toEqual([
      `marketing:${CONSENT_VERSIONS.marketing}:false:signup`,
      `privacy:${CONSENT_VERSIONS.privacy}:true:signup`,
      `terms:${CONSENT_VERSIONS.terms}:true:signup`,
    ]);
  });

  it("takes the one version a request names for both documents while both hold that version", async () => {
    expect(CONSENT_VERSIONS.privacy).toBe(CONSENT_VERSIONS.terms);
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    expect(await consentLog()).toContain(`privacy:${CONSENT_VERSIONS.privacy}:true:signup`);
  });
});

describe("recordSignupConsent: the write itself binds the privacy row to a named version", () => {
  async function accountWithoutLog(): Promise<string> {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
    await getDb().delete(consentRecord);
    return row!.id;
  }

  async function expectNothingLogged(account: Parameters<typeof recordSignupConsent>[0]): Promise<void> {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(recordSignupConsent(account)).rejects.toThrow("did not accept the current Privacy notice");
      expect(await consentLog()).toEqual([]);
      expect(await userCount()).toBe(0);
    } finally {
      logged.mockRestore();
    }
  }

  it("refuses and removes the account when only the Terms version was named and the Privacy notice has another", async () => {
    const id = await accountWithoutLog();
    await withServerVersions({ privacy: BUMPED }, () =>
      expectNothingLogged({ id, acceptedTermsVersion: CONSENT_VERSIONS.terms }),
    );
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["a fabricated version", "v999-made-up"],
    ["an outdated version", "2020-01-01"],
    ["a number", 20260930],
    ["true", true],
  ])("refuses and removes the account when the named privacy version is %s", async (_label, acceptedPrivacyVersion) => {
    const id = await accountWithoutLog();
    await expectNothingLogged({ id, acceptedTermsVersion: CONSENT_VERSIONS.terms, acceptedPrivacyVersion });
  });

  it("writes the privacy row at the named version", async () => {
    const id = await accountWithoutLog();
    await withServerVersions({ privacy: BUMPED }, async () => {
      await recordSignupConsent({ id, acceptedTermsVersion: CONSENT_VERSIONS.terms, acceptedPrivacyVersion: BUMPED });
      expect(await consentLog()).toContain(`privacy:${BUMPED}:true:signup`);
      expect(await consentLog()).toContain(`terms:${SHOWN.terms}:true:signup`);
    });
  });
});

describe("onboarding records consent only at the versions the screen showed", () => {
  const post = (cookie: string, json: unknown) =>
    callRoute(onboardingPOST, { method: "POST", url: "/api/me/onboarding", cookie, json });

  /** What the onboarding screen sends for an account, given the versions the page was rendered with. */
  async function screenBody(userId: string, shown: { terms: string; privacy: string }) {
    const needed = consentToConfirm(await getConsentState(userId), shown);
    const built = buildOnboardingBody({ needed, ticked: { terms: true, privacy: true }, versions: shown });
    if (!built.ok) throw new Error("expected a body");
    return built.body;
  }

  it("is refused for a page rendered before the Terms changed, and nothing is recorded at the new version", async () => {
    const atlas = await createVerifiedUser({ email: EMAIL });
    const stale = await screenBody(atlas.userId, SHOWN);
    await withServerVersions({ terms: BUMPED }, async () => {
      const before = await consentLog();
      const response = await post(atlas.cookie, stale);
      expect(response.status).toBe(422);
      const failure = describeApiFailure(response.status, await response.text());
      expect(failure.fields).toEqual(["termsVersion"]);
      expect(describeAgreementRefusal(failure)).toBe(
        "The Terms changed while this page was open. Reload this page, read the current Terms, and agree again.",
      );
      expect(await consentLog()).toEqual(before);
      expect((await consentLog()).filter((row) => row.includes(BUMPED))).toEqual([]);
    });
  });

  it("is refused for a page rendered before the Privacy notice changed", async () => {
    const atlas = await createVerifiedUser({ email: EMAIL });
    const stale = await screenBody(atlas.userId, SHOWN);
    await withServerVersions({ privacy: BUMPED }, async () => {
      const response = await post(atlas.cookie, stale);
      expect(response.status).toBe(422);
      expect(describeApiFailure(response.status, await response.text()).fields).toEqual(["privacyVersion"]);
      expect((await consentLog()).filter((row) => row.includes(BUMPED))).toEqual([]);
    });
  });

  it("is accepted for a page rendered with the current versions, and the rows carry those versions", async () => {
    const atlas = await createVerifiedUser({ email: EMAIL });
    await withServerVersions({ terms: BUMPED }, async () => {
      const shown = { terms: BUMPED, privacy: SHOWN.privacy };
      expect(consentToConfirm(await getConsentState(atlas.userId), shown)).toEqual(["terms"]);
      const response = await post(atlas.cookie, await screenBody(atlas.userId, shown));
      expect(response.status).toBe(200);
      expect(await consentLog()).toContain(`terms:${BUMPED}:true:onboarding`);
    });
  });
});
