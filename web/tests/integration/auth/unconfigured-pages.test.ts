import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import { closeDb } from "@/server/db/client";

import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";
import { htmlToText } from "../../unit/components/support/render";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const NOTICE = "This deployment is not configured yet.";
const TOKEN = "reset-token-for-page-test";

type Query = Record<string, string | string[] | undefined>;

/** The markup the page itself sends for a query, read from the real configuration. */
async function verifyPage(query: Query = {}): Promise<string> {
  return renderToStaticMarkup(await VerifyEmailPage({ searchParams: Promise.resolve(query) }));
}

async function resetPage(query: Query = {}): Promise<string> {
  return renderToStaticMarkup(await ResetPasswordPage({ searchParams: Promise.resolve(query) }));
}

/**
 * The verify and reset pages hand the configured flag of the deployment to
 * their screens, as sign-in, sign-up, and forgot-password do. Every visible
 * control works: a form is shown only where its request can succeed.
 */
describe("the verify page", () => {
  it("shows the steps and the form on a configured deployment", async () => {
    const html = await verifyPage();
    expect(htmlToText(html)).toContain("Your account was created");
    expect(html).toContain("<form");
    expect(htmlToText(html)).not.toContain(NOTICE);
  });

  it.each([
    ["waiting", {}],
    ["opened", { step: "opened" }],
    ["invalid", { error: "INVALID_TOKEN" }],
  ] as Array<[string, Query]>)("shows only the notice in the %s state when storage is not configured", async (_label, query) => {
    setTestEnv({ DATABASE_URL: undefined });
    const html = await verifyPage(query);
    const text = htmlToText(html);
    expect(text).toContain(NOTICE);
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/<(?:input|select|textarea|button)\b/);
    expect(text).not.toContain("Your account was created");
  });

  it("shows only the notice when another required variable is missing", async () => {
    setTestEnv({ BETTER_AUTH_SECRET: undefined });
    const html = await verifyPage();
    expect(htmlToText(html)).toContain(NOTICE);
    expect(html).not.toContain("<form");
  });
});

describe("the reset page", () => {
  it("shows the new password form for a link with a token on a configured deployment", async () => {
    const html = await resetPage({ token: TOKEN });
    expect(html).toContain("<form");
    expect(html).toContain('name="newPassword"');
    expect(htmlToText(html)).not.toContain(NOTICE);
  });

  it("shows only the notice when storage is not configured, even for a link with a token", async () => {
    setTestEnv({ DATABASE_URL: undefined });
    const html = await resetPage({ token: TOKEN });
    expect(htmlToText(html)).toContain(NOTICE);
    expect(html).not.toContain("<form");
    expect(html).not.toMatch(/<(?:input|select|textarea|button)\b/);
    expect(html).not.toContain(TOKEN);
  });
});
