import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { requireOnboardedUser } from "@/server/auth/guards";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import { createVerifiedUser, type VerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

type Kind = "terms" | "privacy";

async function onboarded(): Promise<VerifiedUser> {
  return createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
}

async function outcome(account: VerifiedUser): Promise<"passes" | AppError> {
  try {
    await requireOnboardedUser(new Headers({ cookie: account.cookie }));
    return "passes";
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
}

async function expectSentToOnboarding(account: VerifiedUser): Promise<void> {
  const result = await outcome(account);
  expect(result).toBeInstanceOf(AppError);
  expect(result).toMatchObject({ code: "conflict", details: { onboarding: true } });
}

/** Append a later consent row, the way a change of mind or a new document version would. */
async function appendConsent(
  account: VerifiedUser,
  row: { kind: Kind | "marketing"; version: string; granted: boolean },
): Promise<void> {
  await getDb()
    .insert(consentRecord)
    .values({ userId: account.userId, source: "settings", recordedAt: new Date(Date.now() + 60_000), ...row });
}

async function removeConsent(account: VerifiedUser, kind: Kind): Promise<void> {
  await getDb()
    .delete(consentRecord)
    .where(and(eq(consentRecord.userId, account.userId), eq(consentRecord.kind, kind)));
}

/**
 * The guard that every application route sits behind reads the consent log
 * itself. One probe per state that must not pass.
 */
describe("requireOnboardedUser reads the newest consent records", () => {
  it("passes with terms and privacy granted at the current versions", async () => {
    expect(await outcome(await onboarded())).toBe("passes");
  });

  it.each(["terms", "privacy"] as const)("refuses when the %s record is missing", async (kind) => {
    const account = await onboarded();
    await removeConsent(account, kind);
    await expectSentToOnboarding(account);
  });

  it.each(["terms", "privacy"] as const)("refuses when the newest %s record is a withdrawal", async (kind) => {
    const account = await onboarded();
    await appendConsent(account, { kind, version: CONSENT_VERSIONS[kind], granted: false });
    await expectSentToOnboarding(account);
  });

  it.each(["terms", "privacy"] as const)("refuses when the newest %s record is for an outdated version", async (kind) => {
    const account = await onboarded();
    await appendConsent(account, { kind, version: "2020-01-01", granted: true });
    await expectSentToOnboarding(account);
  });

  it.each(["terms", "privacy"] as const)("refuses when the newest %s record is for a fabricated version", async (kind) => {
    const account = await onboarded();
    await appendConsent(account, { kind, version: "v999-made-up", granted: true });
    await expectSentToOnboarding(account);
  });

  it.each(["terms", "privacy"] as const)("refuses when the only %s record has an empty version", async (kind) => {
    const account = await onboarded();
    await removeConsent(account, kind);
    await getDb().insert(consentRecord).values({ userId: account.userId, kind, version: "", granted: true, source: "signup" });
    await expectSentToOnboarding(account);
  });

  it("does not let granted marketing consent stand in for the Terms", async () => {
    const account = await onboarded();
    await removeConsent(account, "terms");
    await appendConsent(account, { kind: "marketing", version: CONSENT_VERSIONS.marketing, granted: true });
    await expectSentToOnboarding(account);
  });

  it("does not let another account's consent count", async () => {
    const account = await onboarded();
    const other = await createVerifiedUser({ email: "nova@orbitdiff.test", onboarded: true });
    await removeConsent(account, "privacy");
    expect(await outcome(other)).toBe("passes");
    await expectSentToOnboarding(account);
  });

  it("passes again once the current version is granted after a withdrawal", async () => {
    const account = await onboarded();
    await appendConsent(account, { kind: "terms", version: CONSENT_VERSIONS.terms, granted: false });
    await expectSentToOnboarding(account);
    await getDb().insert(consentRecord).values({
      userId: account.userId,
      kind: "terms",
      version: CONSENT_VERSIONS.terms,
      granted: true,
      source: "onboarding",
      recordedAt: new Date(Date.now() + 120_000),
    });
    expect(await outcome(account)).toBe("passes");
  });
});
