import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { handleAuthRequest } from "@/server/auth/handler";
import { closeDb, getDb } from "@/server/db/client";
import { mailCapture, user } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { settleBackground } from "@/server/http/background";

import { authRequest, signUp } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv } from "../../helpers/env";
import { extractLink, latestMail } from "../../helpers/mail";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const EMAIL = "atlas@orbitdiff.test";

/** Values that pass a "one leading slash" test and still leave the site once a browser resolves them. */
const LEAVES_THE_SITE = [
  "/.//evil.example",
  "/.//evil.example/sign-in",
  "/..//evil.example",
  "/..//evil.example/x?y=1",
  "/a/..//evil.example",
  "/%2e//evil.example",
  "/%2e%2e//evil.example",
  "/.//evil.example#frag",
];

/**
 * Open a link the way a mail client or a stranger's page would: a plain GET
 * with no Origin header and no cookie.
 */
async function open(query: Record<string, string>): Promise<Response> {
  const url = new URL(`${getEnv().baseUrl}/api/auth/verify-email`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await handleAuthRequest(new Request(url));
  await settleBackground();
  return response;
}

/** The origin a browser lands on when it follows the response, or null when the response does not redirect. */
function destinationOrigin(response: Response): string | null {
  const location = response.headers.get("location");
  if (location === null) return null;
  return new URL(location, `${getEnv().baseUrl}/api/auth/verify-email`).origin;
}

async function expectRefusedCallback(response: Response): Promise<void> {
  expect(response.status).toBe(422);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(((await response.json()) as { code: string }).code).toBe("INVALID_CALLBACK_URL");
}

/** The token of the newest confirmation message for the test address. */
async function mailedToken(): Promise<string> {
  const mail = await latestMail(EMAIL, "verify_email");
  return new URL(extractLink(mail!)).searchParams.get("token") ?? "";
}

describe("the verification link never redirects to another host", () => {
  it.each(LEAVES_THE_SITE)("refuses the callback %s when the link carries no token", async (callbackURL) => {
    const response = await open({ callbackURL });
    expect(destinationOrigin(response)).not.toBe("http://evil.example");
    await expectRefusedCallback(response);
  });

  it.each(LEAVES_THE_SITE)("refuses the callback %s when the token is not valid", async (callbackURL) => {
    const response = await open({ token: "x", callbackURL });
    expect(destinationOrigin(response)).not.toBe("http://evil.example");
    await expectRefusedCallback(response);
  });

  it.each(LEAVES_THE_SITE)("refuses the callback %s when the token names an account that is gone", async (callbackURL) => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    const token = await mailedToken();
    await getDb().delete(user).where(eq(user.email, EMAIL));
    await expectRefusedCallback(await open({ token, callbackURL }));
  });

  it.each(LEAVES_THE_SITE)("refuses the callback %s for a valid token, and leaves no proof", async (callbackURL) => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    await expectRefusedCallback(await open({ token: await mailedToken(), callbackURL }));
  });

  it("still returns a failed link to a path on this site, with the error", async () => {
    const response = await open({ token: "x", callbackURL: "/verify-email?step=opened#top" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/verify-email?step=opened&error=INVALID_TOKEN#top");
    expect(destinationOrigin(response)).toBe(getEnv().baseUrl);
  });

  it("still returns a link without a callback to the home page, with the error", async () => {
    const response = await open({ token: "x" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/?error=INVALID_TOKEN");
  });

  it("still returns a valid link to its callback path", async () => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    const response = await open({ token: await mailedToken(), callbackURL: "/verify-email?step=opened" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/verify-email?step=opened");
  });
});

describe("no request stores or mails a redirect target that leaves the site", () => {
  it.each(LEAVES_THE_SITE)("refuses %s as the callback of a sign-up", async (callbackURL) => {
    const response = await signUp({ email: EMAIL, extra: { callbackURL } });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_CALLBACK_URL");
    expect(await getDb().select({ id: user.id }).from(user)).toEqual([]);
    expect(await getDb().select({ id: mailCapture.id }).from(mailCapture)).toEqual([]);
  });

  it.each(LEAVES_THE_SITE)("refuses %s as the page of a password reset", async (redirectTo) => {
    const response = await authRequest("/request-password-reset", { json: { email: EMAIL, redirectTo } });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_REDIRECT_URL");
  });

  it.each(LEAVES_THE_SITE)("refuses %s as the callback of a new confirmation message", async (callbackURL) => {
    expect((await signUp({ email: EMAIL })).status).toBe(200);
    await getDb().delete(mailCapture);
    const response = await authRequest("/send-verification-email", { json: { email: EMAIL, callbackURL } });
    expect(response.status).toBe(422);
    expect(await latestMail(EMAIL, "verify_email")).toBeNull();
  });
});
