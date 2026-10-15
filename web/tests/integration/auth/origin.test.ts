import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { mailCapture, user } from "@/server/db/schema";

import { authRequest, createVerifiedUser, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

describe("cross-site requests to the auth endpoints", () => {
  it("refuses a cookie-bearing request from another origin", async () => {
    const { cookie } = await createVerifiedUser({ email: EMAIL, name: "Atlas" });
    const response = await authRequest("/update-user", {
      json: { name: "Renamed elsewhere" },
      cookie,
      headers: { origin: "https://evil.test" },
    });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("INVALID_ORIGIN");
    const [row] = await getDb().select().from(user).where(eq(user.email, EMAIL));
    expect(row?.name).toBe("Atlas");
  });

  it("refuses to send a verification link that returns to another site", async () => {
    const response = await signUp({ email: EMAIL, extra: { callbackURL: "https://evil.test/landing" } });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("INVALID_CALLBACK_URL");
    expect(await getDb().select().from(user)).toEqual([]);
  });

  it("refuses a password reset that would redirect to another site", async () => {
    await createVerifiedUser({ email: EMAIL });
    const response = await authRequest("/request-password-reset", {
      json: { email: EMAIL, redirectTo: "https://evil.test/reset" },
    });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("INVALID_REDIRECT_URL");
  });

  it("accepts a relative callback path on the app itself", async () => {
    const response = await signUp({ email: EMAIL, extra: { callbackURL: "/onboarding" } });
    expect(response.status).toBe(200);
  });
});

describe("size and shape of callback paths", () => {
  const longPath = `/${"a".repeat(600)}`;

  it("refuses a sign-up whose callback path is longer than 512 characters", async () => {
    const response = await signUp({ email: EMAIL, extra: { callbackURL: longPath } });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("INVALID_CALLBACK_URL");
    expect(await getDb().select().from(user)).toEqual([]);
    expect(await getDb().select().from(mailCapture)).toEqual([]);
  });

  it("stores a verification mail of bounded size for the longest accepted callback path", async () => {
    const response = await signUp({ email: EMAIL, extra: { callbackURL: `/${"a".repeat(511)}` } });
    expect(response.status).toBe(200);
    const [mail] = await getDb().select().from(mailCapture);
    expect(mail!.body.length).toBeLessThan(1_500);
  });

  it("refuses a megabyte callback path without storing anything", async () => {
    const response = await signUp({ email: EMAIL, extra: { callbackURL: `/${"a".repeat(1_000_000)}` } });
    expect(response.status).toBe(422);
    expect(await getDb().select().from(user)).toEqual([]);
    expect(await getDb().select().from(mailCapture)).toEqual([]);
  });

  it("refuses callback values that are not a plain path on this site", async () => {
    const base = "http://127.0.0.1:3100";
    for (const callbackURL of [`${base}/onboarding`, "onboarding", "", "/on boarding", "/a\\b", 7, null, ["/a"]]) {
      const response = await signUp({ email: EMAIL, extra: { callbackURL } });
      expect([400, 403, 422], JSON.stringify(callbackURL)).toContain(response.status);
    }
    expect(await getDb().select().from(user)).toEqual([]);
  });

  it("applies the same rule to reset, resend, and sign-in requests", async () => {
    await createVerifiedUser({ email: EMAIL });
    await getDb().delete(mailCapture);
    const reset = await authRequest("/request-password-reset", { json: { email: EMAIL, redirectTo: longPath } });
    expect(reset.status).toBe(422);
    expect((await reset.json()).code).toBe("INVALID_REDIRECT_URL");
    const resend = await authRequest("/send-verification-email", {
      json: { email: EMAIL, callbackURL: longPath },
    });
    expect(resend.status).toBe(422);
    expect((await resend.json()).code).toBe("INVALID_CALLBACK_URL");
    const signedIn = await authRequest("/sign-in/email", {
      json: { email: EMAIL, password: "orbit-test-pw-1", callbackURL: longPath },
    });
    expect(signedIn.status).toBe(422);
    expect(await getDb().select().from(mailCapture)).toEqual([]);
  });
});
