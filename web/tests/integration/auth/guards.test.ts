import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import {
  getSessionUser,
  isAdminEmail,
  requireAdmin,
  requireOnboardedUser,
  requireUser,
} from "@/server/auth/guards";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, session, user } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import { createVerifiedUser, markOnboarded } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const ADMIN = "owner@orbitdiff.test";
const MEMBER = "nova@orbitdiff.test";

const withCookie = (cookie: string) => new Headers({ cookie });

async function thrown(run: () => Promise<unknown>): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected the guard to throw");
}

describe("getSessionUser", () => {
  it("returns null without a session cookie", async () => {
    expect(await getSessionUser(new Headers())).toBeNull();
    expect(await getSessionUser(withCookie("better-auth.session_token=forged.value"))).toBeNull();
  });

  it("returns the signed-in user with the application fields", async () => {
    const created = await createVerifiedUser({ email: MEMBER, name: "Nova", timezone: "Europe/Berlin" });
    const found = await getSessionUser(withCookie(created.cookie));
    expect(found).toMatchObject({
      id: created.userId,
      email: MEMBER,
      name: "Nova",
      emailVerified: true,
      status: "active",
      timezone: "Europe/Berlin",
      reviewHour: 9,
      onboardedAt: null,
    });
  });

  it("reads the database every time, so a revoked session stops at once", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    expect(await getSessionUser(withCookie(created.cookie))).not.toBeNull();
    await getDb().delete(session).where(eq(session.userId, created.userId));
    expect(await getSessionUser(withCookie(created.cookie))).toBeNull();
  });
});

describe("requireUser", () => {
  it("throws unauthenticated without a session", async () => {
    const error = await thrown(() => requireUser(new Headers()));
    expect(error.code).toBe("unauthenticated");
    expect(error.status).toBe(401);
  });

  it("returns the user for a verified, active account", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    expect((await requireUser(withCookie(created.cookie))).id).toBe(created.userId);
  });

  it("refuses a user whose status was set to suspended in the database", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, created.userId));
    const error = await thrown(() => requireUser(withCookie(created.cookie)));
    expect(error.code).toBe("suspended");
    expect(error.status).toBe(403);
  });

  it("refuses a user with any status other than active", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    await getDb().update(user).set({ status: null }).where(eq(user.id, created.userId));
    expect((await thrown(() => requireUser(withCookie(created.cookie)))).code).toBe("suspended");
  });

  it("refuses a session whose email is no longer verified", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, created.userId));
    const error = await thrown(() => requireUser(withCookie(created.cookie)));
    expect(error.code).toBe("unverified");
    expect(error.status).toBe(403);
  });
});

describe("requireOnboardedUser", () => {
  it("throws conflict with an onboarding marker until onboarding is complete", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    const error = await thrown(() => requireOnboardedUser(withCookie(created.cookie)));
    expect(error.code).toBe("conflict");
    expect(error.details).toEqual({ onboarding: true });
  });

  it("passes once onboarded_at is set and sign-up consent is on record", async () => {
    const created = await createVerifiedUser({ email: MEMBER });
    await markOnboarded(created.userId);
    expect((await requireOnboardedUser(withCookie(created.cookie))).id).toBe(created.userId);
  });

  it("requires a privacy consent record", async () => {
    const created = await createVerifiedUser({ email: MEMBER, onboarded: true });
    await getDb()
      .delete(consentRecord)
      .where(and(eq(consentRecord.userId, created.userId), eq(consentRecord.kind, "privacy")));
    const error = await thrown(() => requireOnboardedUser(withCookie(created.cookie)));
    expect(error.details).toEqual({ onboarding: true });
  });

  it("requires the latest terms record to be granted at the current version", async () => {
    const created = await createVerifiedUser({ email: MEMBER, onboarded: true });
    await getDb()
      .update(consentRecord)
      .set({ version: "2020-01-01" })
      .where(and(eq(consentRecord.userId, created.userId), eq(consentRecord.kind, "terms")));
    expect((await thrown(() => requireOnboardedUser(withCookie(created.cookie)))).code).toBe("conflict");
    await getDb().insert(consentRecord).values({
      userId: created.userId,
      kind: "terms",
      version: CONSENT_VERSIONS.terms,
      granted: true,
      source: "onboarding",
    });
    expect((await requireOnboardedUser(withCookie(created.cookie))).id).toBe(created.userId);
  });

  it("still applies the requireUser checks first", async () => {
    expect((await thrown(() => requireOnboardedUser(new Headers()))).code).toBe("unauthenticated");
  });
});

describe("admin", () => {
  it("recognizes only configured addresses, ignoring case and spaces", () => {
    expect(isAdminEmail("Owner@OrbitDiff.test ")).toBe(true);
    expect(isAdminEmail(MEMBER)).toBe(false);
    setTestEnv({ ADMIN_EMAILS: "" });
    expect(isAdminEmail(ADMIN)).toBe(false);
  });

  it("passes for the configured, verified, active address", async () => {
    const created = await createVerifiedUser({ email: ADMIN });
    expect((await requireAdmin(withCookie(created.cookie))).email).toBe(ADMIN);
  });

  it("answers not_found to a second verified user", async () => {
    await createVerifiedUser({ email: ADMIN });
    const member = await createVerifiedUser({ email: MEMBER });
    const error = await thrown(() => requireAdmin(withCookie(member.cookie)));
    expect(error.code).toBe("not_found");
    expect(error.status).toBe(404);
  });

  it("answers not_found without a session", async () => {
    expect((await thrown(() => requireAdmin(new Headers()))).code).toBe("not_found");
  });

  it("answers not_found when the admin address is not verified or not active", async () => {
    const created = await createVerifiedUser({ email: ADMIN });
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, created.userId));
    expect((await thrown(() => requireAdmin(withCookie(created.cookie)))).code).toBe("not_found");
    await getDb()
      .update(user)
      .set({ emailVerified: true, status: "suspended" })
      .where(eq(user.id, created.userId));
    expect((await thrown(() => requireAdmin(withCookie(created.cookie)))).code).toBe("not_found");
  });

  it("is not granted by the order of sign-up", async () => {
    setTestEnv({ ADMIN_EMAILS: "" });
    const first = await createVerifiedUser({ email: MEMBER });
    expect((await thrown(() => requireAdmin(withCookie(first.cookie)))).code).toBe("not_found");
  });
});
