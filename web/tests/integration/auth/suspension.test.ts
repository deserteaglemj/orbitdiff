import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAuth } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/guards";
import { closeDb, getDb } from "@/server/db/client";
import { account, session, user } from "@/server/db/schema";
import { AppError } from "@/server/http/errors";

import { authRequest, createVerifiedUser, signIn, signUp, TEST_PASSWORD } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";
import { extractLink, latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "nova@orbitdiff.test";

async function suspend(userId: string, status: string | null = "suspended"): Promise<void> {
  await getDb().update(user).set({ status }).where(eq(user.id, userId));
}

async function row(email: string) {
  const [found] = await getDb().select().from(user).where(eq(user.email, email));
  return found;
}

async function expectSuspended(response: Response): Promise<void> {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    code: "ACCOUNT_SUSPENDED",
    message: "This account is suspended.",
  });
}

describe("a suspended account", () => {
  it("cannot start a new login, and a wrong password still reveals nothing", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    await getDb().delete(session);
    await suspend(created.userId);

    const right = await signIn({ email: EMAIL });
    await expectSuspended(right);
    expect(right.headers.getSetCookie().filter((line) => line.includes("session_token"))).toEqual([]);
    expect(await getDb().select().from(session)).toEqual([]);

    const wrong = await signIn({ email: EMAIL, password: "not-the-password" });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("treats every status other than active as suspended", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    for (const status of [null, "banned", ""]) {
      await suspend(created.userId, status);
      await expectSuspended(await signIn({ email: EMAIL }));
    }
  });

  it("cannot change the profile, the password, or the login list through a login that already exists", async () => {
    const created = await createVerifiedUser({ email: EMAIL, name: "Nova" });
    const [credential] = await getDb().select().from(account).where(eq(account.userId, created.userId));
    await suspend(created.userId);
    const calls: Array<[string, unknown]> = [
      ["/update-user", { name: "Renamed", timezone: "Europe/Berlin" }],
      ["/change-password", { currentPassword: TEST_PASSWORD, newPassword: "a-brand-new-password" }],
      ["/revoke-other-sessions", {}],
      ["/revoke-sessions", {}],
    ];
    for (const [path, json] of calls) {
      await expectSuspended(await authRequest(path, { json, cookie: created.cookie }));
    }
    await expectSuspended(await authRequest("/list-sessions", { cookie: created.cookie }));

    const after = await row(EMAIL);
    expect(after).toMatchObject({ name: "Nova", timezone: "UTC", status: "suspended" });
    const [sameCredential] = await getDb().select().from(account).where(eq(account.userId, created.userId));
    expect(sameCredential?.password).toBe(credential?.password);
    expect(await getDb().select().from(session)).toHaveLength(1);
  });

  it("cannot delete itself and come back as a new active account", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    await suspend(created.userId);

    await expectSuspended(
      await authRequest("/delete-user", { json: { password: TEST_PASSWORD }, cookie: created.cookie }),
    );
    expect((await row(EMAIL))?.id).toBe(created.userId);

    expect((await signUp({ email: EMAIL, password: "another-password-9" })).status).toBe(200);
    const after = await row(EMAIL);
    expect(after?.id).toBe(created.userId);
    expect(after?.status).toBe("suspended");
    expect(await getDb().select().from(user)).toHaveLength(1);
  });

  it("stays suspended after a password reset", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    await suspend(created.userId);
    await authRequest("/request-password-reset", { json: { email: EMAIL, redirectTo: "/reset-password" } });
    const token = new URL(extractLink((await latestMail(EMAIL, "reset_password"))!)).searchParams.get("token");
    await authRequest("/reset-password", { json: { newPassword: "a-brand-new-password", token } });
    await expectSuspended(await signIn({ email: EMAIL, password: "a-brand-new-password" }));
    expect((await row(EMAIL))?.status).toBe("suspended");
    expect(await getDb().select().from(session)).toEqual([]);
  });

  it("can still read its state and sign out", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    await suspend(created.userId);

    const current = await authRequest("/get-session", { cookie: created.cookie });
    expect(current.status).toBe(200);
    expect(((await current.json()) as { user: { status: string } }).user.status).toBe("suspended");
    const refused = await requireUser(new Headers({ cookie: created.cookie })).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AppError);
    expect((refused as AppError).code).toBe("suspended");

    expect((await authRequest("/sign-out", { json: {}, cookie: created.cookie })).status).toBe(200);
    expect(await getDb().select().from(session)).toEqual([]);
  });

  it("is refused by server-side calls that would create a login as well", async () => {
    const created = await createVerifiedUser({ email: EMAIL });
    await getDb().delete(session);
    await suspend(created.userId);
    const attempt = await getAuth()
      .api.signInEmail({ body: { email: EMAIL, password: TEST_PASSWORD } })
      .catch((error: unknown) => error);
    expect((attempt as { status?: string }).status).toBe("FORBIDDEN");
    expect(await getDb().select().from(session)).toEqual([]);
  });
});

describe("an active account", () => {
  it("is not affected by the suspension checks", async () => {
    const created = await createVerifiedUser({ email: EMAIL, name: "Nova" });
    expect((await authRequest("/update-user", { json: { name: "Nova Two" }, cookie: created.cookie })).status).toBe(200);
    expect((await authRequest("/list-sessions", { cookie: created.cookie })).status).toBe(200);
    expect((await signIn({ email: EMAIL })).status).toBe(200);
    expect((await row(EMAIL))?.name).toBe("Nova Two");
  });

  it("gets the usual answer, not a suspension notice, without a login", async () => {
    await createVerifiedUser({ email: EMAIL });
    const response = await authRequest("/update-user", { json: { name: "Nobody" } });
    expect(response.status).toBe(401);
  });
});
