import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSIONS } from "@/domain/limits";
import { getAuth } from "@/server/auth/auth";
import { closeDb, getDb } from "@/server/db/client";
import { account, consentRecord, mailCapture, user } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { settleBackground } from "@/server/http/background";

import { authRequest, openVerificationLink, signIn, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

async function userCount(): Promise<number> {
  return (await getDb().select({ id: user.id }).from(user)).length;
}

async function consentFor(email: string) {
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!row) return [];
  return getDb()
    .select({
      kind: consentRecord.kind,
      version: consentRecord.version,
      granted: consentRecord.granted,
      source: consentRecord.source,
    })
    .from(consentRecord)
    .where(eq(consentRecord.userId, row.id))
    .orderBy(asc(consentRecord.kind));
}

describe("registration gate", () => {
  it("creates an unverified user and captures a verification mail", async () => {
    const response = await signUp({ email: "atlas@orbitdiff.test", timezone: "Europe/Berlin" });
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBeNull();
    const [row] = await getDb().select().from(user).where(eq(user.email, "atlas@orbitdiff.test"));
    expect(row).toMatchObject({
      emailVerified: false,
      timezone: "Europe/Berlin",
      status: "active",
      reviewHour: 9,
      onboardedAt: null,
      acceptedTermsVersion: CONSENT_VERSIONS.terms,
    });
    expect(await latestMail("atlas@orbitdiff.test", "verify_email")).not.toBeNull();
  });

  it("stores the password only as a salted hash", async () => {
    await signUp({ email: "atlas@orbitdiff.test", password: "orbit-test-pw-1" });
    await signUp({ email: "nova@orbitdiff.test", password: "orbit-test-pw-1" });
    const rows = await getDb().select({ password: account.password }).from(account);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.password).not.toContain("orbit-test-pw-1");
    expect(rows[0]?.password).not.toBe(rows[1]?.password);
  });

  it("is closed with a clear reason when mail cannot be delivered", async () => {
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    const response = await signUp({ email: "atlas@orbitdiff.test" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "REGISTRATION_CLOSED",
      message: "Registration is closed: email delivery is not configured.",
    });
    expect(await userCount()).toBe(0);
  });

  it("is paused when the number of users has reached capacity", async () => {
    setTestEnv({ CAPACITY_MAX_USERS: "1" });
    expect((await signUp({ email: "atlas@orbitdiff.test" })).status).toBe(200);
    const response = await signUp({ email: "nova@orbitdiff.test" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "REGISTRATION_PAUSED",
      message: "Registration is paused: capacity reached.",
    });
    expect(await userCount()).toBe(1);
  });

  it("requires the access code when one is configured", async () => {
    setTestEnv({ SIGNUP_ACCESS_CODE: "orbit-preview-1" });
    const response = await signUp({ email: "atlas@orbitdiff.test" });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("ACCESS_CODE_REQUIRED");
    expect(await userCount()).toBe(0);
  });

  it("rejects a wrong access code and accepts the right one", async () => {
    setTestEnv({ SIGNUP_ACCESS_CODE: "orbit-preview-1" });
    const wrong = await signUp({
      email: "atlas@orbitdiff.test",
      headers: { "x-signup-code": "orbit-preview-2" },
    });
    expect(wrong.status).toBe(403);
    expect(await userCount()).toBe(0);
    const right = await signUp({
      email: "atlas@orbitdiff.test",
      headers: { "x-signup-code": "orbit-preview-1" },
    });
    expect(right.status).toBe(200);
    expect(await userCount()).toBe(1);
  });

  it("requires acceptance of exactly the current terms version", async () => {
    for (const acceptedTermsVersion of [null, "2020-01-01", ""]) {
      const response = await signUp({ email: "atlas@orbitdiff.test", acceptedTermsVersion });
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("TERMS_NOT_ACCEPTED");
    }
    expect(await userCount()).toBe(0);
  });

  it("records terms and privacy consent at sign-up, and marketing as not granted by default", async () => {
    expect((await signUp({ email: "atlas@orbitdiff.test" })).status).toBe(200);
    expect(await consentFor("atlas@orbitdiff.test")).toEqual([
      { kind: "marketing", version: CONSENT_VERSIONS.marketing, granted: false, source: "signup" },
      { kind: "privacy", version: CONSENT_VERSIONS.privacy, granted: true, source: "signup" },
      { kind: "terms", version: CONSENT_VERSIONS.terms, granted: true, source: "signup" },
    ]);
    const [row] = await getDb().select().from(user).where(eq(user.email, "atlas@orbitdiff.test"));
    expect(row?.marketingOptIn).toBe(false);
  });

  it("records marketing consent as granted only when the user opts in", async () => {
    expect((await signUp({ email: "nova@orbitdiff.test", marketingOptIn: true })).status).toBe(200);
    const rows = await consentFor("nova@orbitdiff.test");
    expect(rows.find((row) => row.kind === "marketing")).toMatchObject({ granted: true });
    const [row] = await getDb().select().from(user).where(eq(user.email, "nova@orbitdiff.test"));
    expect(row?.marketingOptIn).toBe(true);
  });

  it("leaves no account behind when the consent log cannot be written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = getDb();
    await db.execute(sql`
      create function refuse_consent() returns trigger language plpgsql as
      $$ begin raise exception 'consent log is unavailable'; end $$`);
    await db.execute(sql`
      create trigger refuse_consent before insert on consent_record
      for each row execute function refuse_consent()`);
    try {
      const response = await signUp({ email: "atlas@orbitdiff.test" });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await response.text()).not.toContain("consent log is unavailable");
      expect(await userCount()).toBe(0);
      expect(await db.select().from(consentRecord)).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger refuse_consent on consent_record`);
      await db.execute(sql`drop function refuse_consent()`);
      logged.mockRestore();
    }
    expect((await signUp({ email: "atlas@orbitdiff.test" })).status).toBe(200);
    expect(await userCount()).toBe(1);
  });

  it("rejects a timezone that is not a valid IANA zone", async () => {
    for (const timezone of ["Mars/Olympus", "+05:00", "", null, "Europe/Berlin; drop"]) {
      const response = await signUp({ email: "atlas@orbitdiff.test", timezone });
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("INVALID_TIMEZONE");
    }
    expect(await userCount()).toBe(0);
  });

  it("rejects a password shorter than ten characters", async () => {
    const response = await signUp({ email: "atlas@orbitdiff.test", password: "ninechars" });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("PASSWORD_TOO_SHORT");
    expect(await userCount()).toBe(0);
  });

  it("answers a repeated sign-up like a new one, whether the address is pending or verified", async () => {
    const comparable = (record: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(record).filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key)),
      );
    type Answer = { token: null; user: Record<string, unknown> };

    const first = await signUp({ email: "atlas@orbitdiff.test", name: "Atlas" });
    expect(first.status).toBe(200);
    const original = (await first.json()) as Answer;

    // Pending address: the unverified account is replaced and a new mail goes out.
    const pendingRepeat = await signUp({ email: "Atlas@OrbitDiff.test", name: "Atlas" });
    expect(pendingRepeat.status).toBe(200);
    const replaced = (await pendingRepeat.json()) as Answer;
    expect(await userCount()).toBe(1);
    expect(await getDb().select().from(mailCapture)).toHaveLength(2);

    // Verified address: nothing is created, changed, or sent.
    const opened = await openVerificationLink("atlas@orbitdiff.test");
    expect((await signIn({ email: "atlas@orbitdiff.test", cookie: opened.cookie })).status).toBe(200);
    const verifiedRepeat = await signUp({ email: "Atlas@OrbitDiff.test", name: "Atlas" });
    expect(verifiedRepeat.status).toBe(200);
    const synthetic = (await verifiedRepeat.json()) as Answer;
    expect(await userCount()).toBe(1);
    expect(await getDb().select().from(mailCapture)).toHaveLength(2);

    // Same fields and same values, apart from the id and the timestamps: nothing tells the three apart.
    for (const answer of [replaced, synthetic]) {
      expect(answer.token).toBeNull();
      expect(Object.keys(answer.user).sort()).toEqual(Object.keys(original.user).sort());
      expect(comparable(answer.user)).toEqual(comparable(original.user));
    }
  });

  it("responds before the verification mail has been stored", async () => {
    const db = getDb();
    await db.execute(sql`
      create function slow_mail() returns trigger language plpgsql as
      $$ begin perform pg_sleep(0.4); return new; end $$`);
    await db.execute(sql`
      create trigger slow_mail before insert on mail_capture
      for each row execute function slow_mail()`);
    try {
      const baseUrl = getEnv().baseUrl;
      const response = await getAuth().handler(
        new Request(`${baseUrl}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify({
            email: "atlas@orbitdiff.test",
            name: "Atlas",
            password: "orbit-test-pw-1",
            timezone: "UTC",
            acceptedTermsVersion: CONSENT_VERSIONS.terms,
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await db.select().from(mailCapture)).toHaveLength(0);
      await settleBackground();
      expect(await db.select().from(mailCapture)).toHaveLength(1);
    } finally {
      await settleBackground();
      await db.execute(sql`drop trigger slow_mail on mail_capture`);
      await db.execute(sql`drop function slow_mail()`);
    }
  });

  it("refuses password reset and verification mail requests when mail cannot be delivered", async () => {
    setTestEnv({ EMAIL_TRANSPORT: "none" });
    for (const path of ["/request-password-reset", "/send-verification-email"]) {
      const response = await authRequest(path, { json: { email: "atlas@orbitdiff.test" } });
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe("EMAIL_UNAVAILABLE");
    }
  });
});
