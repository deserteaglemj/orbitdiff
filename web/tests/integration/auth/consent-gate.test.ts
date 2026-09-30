import { and, desc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { recordSignupConsent } from "@/server/auth/consent";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, user } from "@/server/db/schema";

import { signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

interface Refusal {
  code: string;
  message: string;
}

async function userCount(): Promise<number> {
  return (await getDb().select({ id: user.id }).from(user)).length;
}

/** Every consent row in the database, read from the log itself. */
async function consentRows() {
  return getDb()
    .select({ kind: consentRecord.kind, version: consentRecord.version, granted: consentRecord.granted })
    .from(consentRecord)
    .orderBy(consentRecord.kind);
}

/** The newest consent row of one kind for an address, read from consent_record. */
async function latestConsent(email: string, kind: "terms" | "privacy" | "marketing") {
  const [row] = await getDb()
    .select({
      kind: consentRecord.kind,
      version: consentRecord.version,
      granted: consentRecord.granted,
      source: consentRecord.source,
    })
    .from(consentRecord)
    .innerJoin(user, eq(user.id, consentRecord.userId))
    .where(and(eq(user.email, email), eq(consentRecord.kind, kind)))
    .orderBy(desc(consentRecord.recordedAt), desc(consentRecord.id))
    .limit(1);
  return row;
}

/** Sign up with `acceptedTermsVersion` set to anything at all, or left out when `value` is undefined. */
function signUpWithTerms(value: unknown, extra: Record<string, unknown> = {}): Promise<Response> {
  return signUp({
    email: EMAIL,
    acceptedTermsVersion: null,
    extra: value === undefined ? extra : { ...extra, acceptedTermsVersion: value },
  });
}

async function expectTermsRefusal(response: Response): Promise<Refusal> {
  expect(response.status).toBe(422);
  const body = (await response.json()) as Refusal;
  expect(body.code).toBe("TERMS_NOT_ACCEPTED");
  expect(await userCount()).toBe(0);
  expect(await consentRows()).toEqual([]);
  return body;
}

describe("sign-up consent gate: acceptance of the Terms", () => {
  it("refuses when acceptedTermsVersion is absent and says it is missing", async () => {
    const refusal = await expectTermsRefusal(await signUpWithTerms(undefined));
    expect(refusal.message).toBe(
      "acceptedTermsVersion is missing. Accept the Terms and the Privacy notice to create an account.",
    );
  });

  it("refuses when acceptedTermsVersion is an empty string and says it is empty", async () => {
    const refusal = await expectTermsRefusal(await signUpWithTerms(""));
    expect(refusal.message).toBe(
      "acceptedTermsVersion is empty. Accept the Terms and the Privacy notice to create an account.",
    );
  });

  it.each([
    ["a number", 20260930],
    ["true", true],
    ["null", null],
    ["a list", [CONSENT_VERSIONS.terms]],
    ["an object", { version: CONSENT_VERSIONS.terms }],
  ])("refuses when acceptedTermsVersion is %s and says it must be text", async (_label, value) => {
    const refusal = await expectTermsRefusal(await signUpWithTerms(value));
    expect(refusal.message).toBe(
      "acceptedTermsVersion must be text. Send the version of the Terms that was accepted.",
    );
  });

  it("refuses a fabricated version, names the current one, and does not echo the value", async () => {
    const refusal = await expectTermsRefusal(await signUpWithTerms("v999-made-up"));
    expect(refusal.message).toBe(
      `acceptedTermsVersion is not the current version of the Terms (${CONSENT_VERSIONS.terms}). ` +
        "Read and accept the current Terms to create an account.",
    );
    expect(refusal.message).not.toContain("v999-made-up");
  });

  it("refuses an outdated version and names the current one", async () => {
    const refusal = await expectTermsRefusal(await signUpWithTerms("2020-01-01"));
    expect(refusal.message).toContain(`not the current version of the Terms (${CONSENT_VERSIONS.terms})`);
  });

  it.each([
    ["a leading space", ` ${CONSENT_VERSIONS.terms}`],
    ["a trailing space", `${CONSENT_VERSIONS.terms} `],
    ["a trailing line break", `${CONSENT_VERSIONS.terms}\n`],
    ["extra text after it", `${CONSENT_VERSIONS.terms}-accepted`],
  ])("refuses the current version with %s", async (_label, value) => {
    const refusal = await expectTermsRefusal(await signUpWithTerms(value));
    expect(refusal.message).toContain("not the current version of the Terms");
  });

  it("refuses when only marketingOptIn is supplied: agreeing to product news accepts nothing else", async () => {
    const refusal = await expectTermsRefusal(await signUpWithTerms(undefined, { marketingOptIn: true }));
    expect(refusal.message).toBe(
      "acceptedTermsVersion is missing. Agreeing to product news does not accept the Terms. " +
        "Accept the Terms and the Privacy notice to create an account.",
    );
  });

  it("records terms and privacy as granted at the current versions once the current Terms are accepted", async () => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    expect(await latestConsent(EMAIL, "terms")).toEqual({
      kind: "terms",
      version: CONSENT_VERSIONS.terms,
      granted: true,
      source: "signup",
    });
    expect(await latestConsent(EMAIL, "privacy")).toEqual({
      kind: "privacy",
      version: CONSENT_VERSIONS.privacy,
      granted: true,
      source: "signup",
    });
  });
});

describe("sign-up consent gate: marketing is a separate, explicit choice", () => {
  it("never grants marketing consent because the Terms were accepted", async () => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    expect(await latestConsent(EMAIL, "marketing")).toEqual({
      kind: "marketing",
      version: CONSENT_VERSIONS.marketing,
      granted: false,
      source: "signup",
    });
    expect((await consentRows()).filter((row) => row.kind === "marketing" && row.granted)).toEqual([]);
  });

  it("records marketing as granted for the boolean true", async () => {
    expect((await signUp({ email: EMAIL, marketingOptIn: true })).status).toBe(200);
    expect(await latestConsent(EMAIL, "marketing")).toMatchObject({ granted: true, source: "signup" });
  });

  it("records marketing as not granted for the boolean false", async () => {
    expect((await signUp({ email: EMAIL, marketingOptIn: false })).status).toBe(200);
    expect(await latestConsent(EMAIL, "marketing")).toMatchObject({ granted: false });
  });

  it.each([
    ['the string "true"', "true"],
    ['the string "on"', "on"],
    ['the string "yes"', "yes"],
    ["the number 1", 1],
    ['the string "1"', "1"],
    ['the string "TRUE"', "TRUE"],
    ["an empty object", {}],
    ["a list holding true", [true]],
    ["null", null],
  ])("records marketing as not granted for %s", async (_label, value) => {
    const response = await signUp({ email: EMAIL, extra: { marketingOptIn: value } });
    expect(response.status).toBe(200);
    expect(await latestConsent(EMAIL, "marketing")).toMatchObject({ granted: false, source: "signup" });
    expect((await consentRows()).filter((row) => row.kind === "marketing" && row.granted)).toEqual([]);
    const [account] = await getDb().select({ optIn: user.marketingOptIn }).from(user).where(eq(user.email, EMAIL));
    expect(account?.optIn).toBe(false);
  });

  it("records marketing as not granted when the value is absent", async () => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    expect(await latestConsent(EMAIL, "marketing")).toMatchObject({ granted: false });
  });
});

describe("recordSignupConsent: the write itself only grants marketing for the boolean true", () => {
  async function createdUserId(): Promise<string> {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
    return row!.id;
  }

  it.each([
    ['the string "true"', "true"],
    ['the string "on"', "on"],
    ['the string "yes"', "yes"],
    ["the number 1", 1],
    ["undefined", undefined],
    ["null", null],
    ["an object", { granted: true }],
  ])("writes a marketing row that is not granted for %s", async (_label, value) => {
    const id = await createdUserId();
    await recordSignupConsent({ id, acceptedTermsVersion: CONSENT_VERSIONS.terms, marketingOptIn: value });
    expect(await latestConsent(EMAIL, "marketing")).toMatchObject({ granted: false });
    expect((await consentRows()).filter((row) => row.kind === "marketing" && row.granted)).toEqual([]);
  });

  it("writes a granted marketing row for the boolean true", async () => {
    const id = await createdUserId();
    await recordSignupConsent({ id, acceptedTermsVersion: CONSENT_VERSIONS.terms, marketingOptIn: true });
    expect((await consentRows()).filter((row) => row.kind === "marketing" && row.granted)).toHaveLength(1);
  });
});

describe("recordSignupConsent: no consent is logged for an account that did not accept the current Terms", () => {
  it.each([
    ["absent", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a fabricated version", "v999-made-up"],
    ["an outdated version", "2020-01-01"],
    ["a number", 20260930],
  ])("refuses and removes the account when its accepted version is %s", async (_label, acceptedTermsVersion) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await signUp({ email: EMAIL })).status).toBe(200);
      const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
      await getDb().delete(consentRecord);
      await expect(
        recordSignupConsent({ id: row!.id, acceptedTermsVersion, marketingOptIn: true }),
      ).rejects.toThrow("did not accept the current Terms");
      expect(await consentRows()).toEqual([]);
      expect(await userCount()).toBe(0);
    } finally {
      logged.mockRestore();
    }
  });
});
