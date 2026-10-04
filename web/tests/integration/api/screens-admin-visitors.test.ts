import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { isValidElement } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as adminPage from "@/app/(app)/admin/page";
import AppLayout from "@/app/(app)/layout";
import { metadata as notFoundMetadata } from "@/app/not-found";
import { AdminScreen } from "@/components/admin/admin-screen";
import { AppShell } from "@/components/app-shell";
import { SuspendedScreen } from "@/components/auth/suspended-screen";
import { proxy } from "@/proxy";
import { closeDb, getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

import { createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv } from "../../helpers";

/**
 * What a full page load of /admin ends in, for each kind of visitor. The
 * request goes through the three places that answer it, in the order Next.js
 * runs them: the real proxy, the real signed-in layout, and the real page.
 * The guards and the database are the real ones. The one thing replaced is
 * `headers()` from next/headers, which only exists inside a request that
 * Next.js is serving: here it returns what the proxy handed on.
 */
const visitor = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => visitor.headers }));

beforeEach(async () => {
  visitor.headers = new Headers();
  await resetDatabase();
});
afterEach(restoreTestEnv);
afterAll(closeDb);

const OWNER = "owner@orbitdiff.test";
const NOVA = "nova@orbitdiff.test";
const ORIGIN = "http://localhost:3201";
const PAGE_SLOT = "the page slot";

type Outcome =
  | { by: "proxy"; redirect: string }
  | { by: "layout"; redirect: string }
  | { by: "layout"; notice: "suspended"; title: unknown }
  | { by: "page"; redirect: string }
  | { by: "page"; notFound: true; title: unknown }
  | { by: "page"; screen: "admin"; title: unknown };

const digestOf = (error: unknown): string => {
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") throw error;
  return digest;
};

/** The path of a redirect that a layout or a page asked for. */
const redirectTarget = (digest: string): string | null =>
  digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;

const title = async (): Promise<unknown> => ((await adminPage.generateMetadata()) as { title?: unknown }).title;

/** The request headers a page receives after the proxy ran, rebuilt from what Next.js encodes on the response. */
function receivedByPage(response: Response): Headers {
  const received = new Headers();
  const prefix = "x-middleware-request-";
  for (const [name, value] of response.headers) {
    if (name.startsWith(prefix)) received.set(name.slice(prefix.length), value);
  }
  return received;
}

async function load(path: string, cookie?: string): Promise<Outcome> {
  const through = proxy(new NextRequest(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} }));
  const location = through.headers.get("location");
  if (location !== null) {
    const target = new URL(location);
    return { by: "proxy", redirect: `${target.pathname}${target.search}` };
  }
  visitor.headers = receivedByPage(through);

  let frame: unknown;
  try {
    frame = await AppLayout({ children: PAGE_SLOT });
  } catch (error) {
    const target = redirectTarget(digestOf(error));
    if (target === null) throw error;
    return { by: "layout", redirect: target };
  }
  if (!isValidElement(frame)) throw new Error("the layout rendered nothing");
  if (frame.type === SuspendedScreen) return { by: "layout", notice: "suspended", title: await title() };
  if (frame.type !== AppShell) throw new Error("the layout rendered something unexpected");

  try {
    const page = await adminPage.default();
    if (!isValidElement(page) || page.type !== AdminScreen) throw new Error("the page rendered something unexpected");
    return { by: "page", screen: "admin", title: await title() };
  } catch (error) {
    const digest = digestOf(error);
    const target = redirectTarget(digest);
    if (target !== null) return { by: "page", redirect: target };
    if (digest !== "NEXT_HTTP_ERROR_FALLBACK;404") throw error;
    return { by: "page", notFound: true, title: await title() };
  }
}

describe("a full page load of /admin", () => {
  it("lets an address that does not exist through the proxy, for comparison", async () => {
    const through = proxy(new NextRequest(`${ORIGIN}/no-such-page`));
    expect(through.status).toBe(200);
    expect(through.headers.get("location")).toBeNull();
  });

  it("sends a visitor without a session cookie to sign-in: the proxy answers", async () => {
    expect(await load("/admin")).toEqual({ by: "proxy", redirect: "/sign-in?next=%2Fadmin" });
  });

  it("sends a forged session cookie to sign-in: the layout answers", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    expect(await load("/admin", "better-auth.session_token=forged.value")).toEqual({
      by: "layout",
      redirect: "/sign-in?next=%2Fadmin",
    });
  });

  it("sends an account whose address is not verified to the verify page: the layout answers", async () => {
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, nova.userId));
    expect(await load("/admin", nova.cookie)).toEqual({ by: "layout", redirect: "/verify-email" });
  });

  it("shows a suspended account the suspended notice, titled as what it is: the layout answers", async () => {
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, nova.userId));
    expect(await load("/admin", nova.cookie)).toEqual({ by: "layout", notice: "suspended", title: "Account suspended" });
  });

  it("gives a suspended admin the same notice and title as any other suspended account", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, owner.userId));
    expect(await load("/admin", owner.cookie)).toEqual({ by: "layout", notice: "suspended", title: "Account suspended" });
  });

  it("sends an account that is not onboarded to onboarding, the admin included: the layout answers", async () => {
    const nova = await createVerifiedUser({ email: NOVA });
    const owner = await createVerifiedUser({ email: OWNER });
    expect(await load("/admin", nova.cookie)).toEqual({ by: "layout", redirect: "/onboarding" });
    expect(await load("/admin", owner.cookie)).toEqual({ by: "layout", redirect: "/onboarding" });
  });

  it("answers not found to a signed-in, verified, active, onboarded account that is not the admin: the page answers", async () => {
    await createVerifiedUser({ email: OWNER, onboarded: true });
    const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
    expect(await load("/admin", nova.cookie)).toEqual({ by: "page", notFound: true, title: notFoundMetadata.title });
  });

  it("opens for the admin", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    expect(await load("/admin", owner.cookie)).toEqual({ by: "page", screen: "admin", title: "Admin" });
  });

  it("sends everyone to sign-in on a deployment that is not configured, the admin's cookie included", async () => {
    const owner = await createVerifiedUser({ email: OWNER, onboarded: true });
    setTestEnv({ DATABASE_URL: undefined });
    expect(await load("/admin")).toEqual({ by: "proxy", redirect: "/sign-in?next=%2Fadmin" });
    expect(await load("/admin", owner.cookie)).toEqual({ by: "layout", redirect: "/sign-in" });
    expect(await title()).toBe(notFoundMetadata.title);
  });
});
