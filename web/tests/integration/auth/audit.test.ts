import { asc, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { auditEvent, user } from "@/server/db/schema";

import { authRequest, createVerifiedUser, signUp, TEST_PASSWORD } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { extractLink, latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const ATLAS = "atlas@orbitdiff.test";
const NOVA = "nova@orbitdiff.test";

async function auditRows() {
  return getDb()
    .select({ action: auditEvent.action, actorUserId: auditEvent.actorUserId, detail: auditEvent.detail })
    .from(auditEvent)
    .orderBy(asc(auditEvent.at), asc(auditEvent.id));
}

async function userCount(): Promise<number> {
  return (await getDb().select({ id: user.id }).from(user)).length;
}

/** Everything stored in audit_event, as text, to search for values that must never be there. */
async function auditText(): Promise<string> {
  return JSON.stringify(await getDb().select().from(auditEvent));
}

async function resetPassword(email: string): Promise<Response> {
  await authRequest("/request-password-reset", { json: { email, redirectTo: "/reset-password" } });
  const mail = await latestMail(email, "reset_password");
  const token = new URL(extractLink(mail!)).searchParams.get("token");
  return authRequest("/reset-password", { json: { newPassword: "a-brand-new-password", token } });
}

describe("audit: refused registrations", () => {
  const refusals: Array<[string, () => Promise<Response>, string]> = [
    [
      "no operator is named",
      () => {
        setTestEnv({ OPERATOR_NAME: undefined });
        return signUp({ email: ATLAS });
      },
      "REGISTRATION_CLOSED",
    ],
    [
      "mail cannot be delivered",
      () => {
        setTestEnv({ EMAIL_TRANSPORT: "none" });
        return signUp({ email: ATLAS });
      },
      "REGISTRATION_CLOSED",
    ],
    [
      "the access code is missing",
      () => {
        setTestEnv({ SIGNUP_ACCESS_CODE: "orbit-preview-1" });
        return signUp({ email: ATLAS });
      },
      "ACCESS_CODE_REQUIRED",
    ],
    ["the Terms are not accepted", () => signUp({ email: ATLAS, acceptedTermsVersion: null }), "TERMS_NOT_ACCEPTED"],
    ["a field is not allowed", () => signUp({ email: ATLAS, extra: { role: "admin" } }), "FIELD_NOT_ALLOWED"],
    ["the timezone is not valid", () => signUp({ email: ATLAS, timezone: "Mars/Olympus" }), "INVALID_TIMEZONE"],
    ["the name is blank", () => signUp({ email: ATLAS, name: "   " }), "INVALID_NAME"],
  ];

  it.each(refusals)("records the refusal code when %s", async (_label, attempt, code) => {
    const response = await attempt();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await response.json()).code).toBe(code);
    expect(await auditRows()).toEqual([{ action: "registration_refused", actorUserId: null, detail: { code } }]);
    expect(await userCount()).toBe(0);
  });

  it("records the refusal code when capacity is reached", async () => {
    setTestEnv({ CAPACITY_MAX_USERS: "1" });
    expect((await signUp({ email: NOVA })).status).toBe(200);
    expect((await signUp({ email: ATLAS })).status).toBe(503);
    expect(await auditRows()).toEqual([
      { action: "registration_refused", actorUserId: null, detail: { code: "REGISTRATION_PAUSED" } },
    ]);
  });

  it("stores nothing about the person who was refused", async () => {
    await signUp({
      email: ATLAS,
      name: "Atlas Tester",
      acceptedTermsVersion: "2020-01-01",
      headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "orbit-probe-agent" },
    });
    const text = await auditText();
    expect(text).toContain("registration_refused");
    for (const secret of [ATLAS, "atlas", "Atlas Tester", TEST_PASSWORD, "203.0.113.9", "orbit-probe-agent", "2020-01-01"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("records nothing for a registration that is accepted", async () => {
    expect((await signUp({ email: ATLAS })).status).toBe(200);
    expect(await auditRows()).toEqual([]);
  });

  it("still refuses, and creates no user, when the audit row cannot be written", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = getDb();
    await db.execute(sql`
      create function refuse_audit() returns trigger language plpgsql as
      $$ begin raise exception 'audit log is unavailable'; end $$`);
    await db.execute(sql`
      create trigger refuse_audit before insert on audit_event
      for each row execute function refuse_audit()`);
    try {
      const response = await signUp({ email: ATLAS, acceptedTermsVersion: null });
      expect(response.status).toBe(422);
      expect((await response.json()).code).toBe("TERMS_NOT_ACCEPTED");
      expect(await userCount()).toBe(0);
      expect(logged.mock.calls.map((call) => call.join(" ")).join("\n")).toContain("[auth.audit]");
    } finally {
      await db.execute(sql`drop trigger refuse_audit on audit_event`);
      await db.execute(sql`drop function refuse_audit()`);
      logged.mockRestore();
    }
  });
});

describe("audit: completed password resets", () => {
  it("records the reset with the account as the actor and nothing else", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    expect((await resetPassword(ATLAS)).status).toBe(200);
    expect(await auditRows()).toEqual([
      { action: "password_reset_completed", actorUserId: atlas.userId, detail: null },
    ]);
    const text = await auditText();
    expect(text).not.toContain(ATLAS);
    expect(text).not.toContain("a-brand-new-password");
  });

  it("records nothing when the reset token is not valid", async () => {
    await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/reset-password", {
      json: { newPassword: "a-brand-new-password", token: "not-a-real-token" },
    });
    expect(response.status).toBe(400);
    expect(await auditRows()).toEqual([]);
  });
});

describe("audit: deleted accounts", () => {
  it("records the deletion without an actor", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password: TEST_PASSWORD }, cookie: atlas.cookie });
    expect(response.status).toBe(200);
    expect(await auditRows()).toEqual([{ action: "account_deleted", actorUserId: null, detail: null }]);
  });

  it("leaves no audit row that points at the deleted account, and keeps another account's rows", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const nova = await createVerifiedUser({ email: NOVA });
    expect((await resetPassword(ATLAS)).status).toBe(200);
    expect((await resetPassword(NOVA)).status).toBe(200);
    // The reset signed both accounts out everywhere, so deletion needs a fresh sign-in.
    const signedIn = await authRequest("/sign-in/email", {
      json: { email: ATLAS, password: "a-brand-new-password" },
    });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");

    const response = await authRequest("/delete-user", { json: { password: "a-brand-new-password" }, cookie });
    expect(response.status).toBe(200);

    const rows = await auditRows();
    expect(rows.filter((row) => row.actorUserId === atlas.userId)).toEqual([]);
    expect(rows).toContainEqual({ action: "password_reset_completed", actorUserId: null, detail: null });
    expect(rows).toContainEqual({ action: "password_reset_completed", actorUserId: nova.userId, detail: null });
    expect(rows).toContainEqual({ action: "account_deleted", actorUserId: null, detail: null });
    const text = await auditText();
    expect(text).not.toContain(atlas.userId);
    expect(text).not.toContain(ATLAS);
  });

  it("records nothing when the deletion is refused", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const response = await authRequest("/delete-user", { json: { password: "not-the-password" }, cookie: atlas.cookie });
    expect(response.status).toBe(400);
    expect(await auditRows()).toEqual([]);
    expect(await userCount()).toBe(1);
  });
});
