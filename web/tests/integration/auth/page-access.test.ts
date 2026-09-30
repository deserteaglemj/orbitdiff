import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolvePageAccess } from "@/server/auth/page-access";
import { hasSessionCookie } from "@/server/auth/paths";
import { closeDb, getDb } from "@/server/db/client";
import { consentRecord, session, user } from "@/server/db/schema";

import { createVerifiedUser } from "../../helpers/auth";
import { resetDatabase } from "../../helpers/db";
import { restoreTestEnv, setTestEnv } from "../../helpers/env";

beforeEach(resetDatabase);
afterEach(restoreTestEnv);
afterAll(closeDb);

const MEMBER = "nova@orbitdiff.test";
const ADMIN = "owner@orbitdiff.test";

const withCookie = (cookie: string) => new Headers({ cookie });

describe("resolvePageAccess: what the signed-in layout does with a request", () => {
  it("sends a request without a session to sign-in, remembering the page", async () => {
    expect(await resolvePageAccess(new Headers(), "/settings")).toEqual({
      kind: "redirect",
      to: "/sign-in?next=%2Fsettings",
    });
  });

  it("sends a forged session cookie to sign-in: the cookie alone opens nothing", async () => {
    const forged = withCookie("better-auth.session_token=forged.value");
    expect(await resolvePageAccess(forged, "/dashboard")).toEqual({
      kind: "redirect",
      to: "/sign-in?next=%2Fdashboard",
    });
  });

  it("sends a revoked session to sign-in", async () => {
    const member = await createVerifiedUser({ email: MEMBER, onboarded: true });
    await getDb().delete(session).where(eq(session.userId, member.userId));
    expect(await resolvePageAccess(withCookie(member.cookie), "/dashboard")).toMatchObject({ kind: "redirect" });
  });

  it("sends a user whose address is not verified to the verify page", async () => {
    const member = await createVerifiedUser({ email: MEMBER, onboarded: true });
    await getDb().update(user).set({ emailVerified: false }).where(eq(user.id, member.userId));
    expect(await resolvePageAccess(withCookie(member.cookie), "/dashboard")).toEqual({
      kind: "redirect",
      to: "/verify-email",
    });
  });

  it("answers suspended for a suspended user, on every page, with no account data", async () => {
    const member = await createVerifiedUser({ email: MEMBER, onboarded: true });
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, member.userId));
    for (const pathname of ["/dashboard", "/onboarding", "/admin"]) {
      expect(await resolvePageAccess(withCookie(member.cookie), pathname)).toEqual({ kind: "suspended" });
    }
  });

  it("sends a user who is not onboarded to onboarding from every other page", async () => {
    const member = await createVerifiedUser({ email: MEMBER });
    for (const pathname of ["/dashboard", "/profiles/abc", "/settings", "/admin"]) {
      expect(await resolvePageAccess(withCookie(member.cookie), pathname)).toEqual({
        kind: "redirect",
        to: "/onboarding",
      });
    }
  });

  it("lets a user who is not onboarded see the onboarding page itself", async () => {
    const member = await createVerifiedUser({ email: MEMBER, name: "Nova" });
    expect(await resolvePageAccess(withCookie(member.cookie), "/onboarding")).toMatchObject({
      kind: "allowed",
      onboarded: false,
      isAdmin: false,
      user: { id: member.userId, email: MEMBER, name: "Nova" },
    });
  });

  it("does not treat a page whose name only starts with onboarding as the onboarding page", async () => {
    const member = await createVerifiedUser({ email: MEMBER });
    expect(await resolvePageAccess(withCookie(member.cookie), "/onboarding-help")).toEqual({
      kind: "redirect",
      to: "/onboarding",
    });
  });

  it("sends a user back to onboarding when the recorded consent is outdated", async () => {
    const member = await createVerifiedUser({ email: MEMBER, onboarded: true });
    await getDb().insert(consentRecord).values({
      userId: member.userId,
      kind: "terms",
      version: "2020-01-01",
      granted: true,
      source: "settings",
      recordedAt: new Date(Date.now() + 60_000),
    });
    expect(await resolvePageAccess(withCookie(member.cookie), "/dashboard")).toEqual({
      kind: "redirect",
      to: "/onboarding",
    });
  });

  it("allows an onboarded user and says they are not an admin", async () => {
    const member = await createVerifiedUser({ email: MEMBER, name: "Nova", onboarded: true });
    expect(await resolvePageAccess(withCookie(member.cookie), "/dashboard")).toMatchObject({
      kind: "allowed",
      onboarded: true,
      isAdmin: false,
      user: { id: member.userId, email: MEMBER, name: "Nova" },
    });
  });

  it("says admin only for the configured admin address", async () => {
    const admin = await createVerifiedUser({ email: ADMIN, onboarded: true });
    expect(await resolvePageAccess(withCookie(admin.cookie), "/dashboard")).toMatchObject({ isAdmin: true });
    setTestEnv({ ADMIN_EMAILS: "" });
    expect(await resolvePageAccess(withCookie(admin.cookie), "/dashboard")).toMatchObject({ isAdmin: false });
  });

  it("hands the layout no credential and no consent detail about the user", async () => {
    const member = await createVerifiedUser({ email: MEMBER, onboarded: true });
    const access = await resolvePageAccess(withCookie(member.cookie), "/dashboard");
    expect(access.kind).toBe("allowed");
    const text = JSON.stringify(access);
    expect(text).not.toMatch(/password|token|secret/i);
  });

  it("treats a missing path as a page that is not onboarding", async () => {
    const member = await createVerifiedUser({ email: MEMBER });
    expect(await resolvePageAccess(withCookie(member.cookie), null)).toEqual({ kind: "redirect", to: "/onboarding" });
    expect(await resolvePageAccess(new Headers(), null)).toEqual({ kind: "redirect", to: "/sign-in" });
  });

  it("sends everyone to sign-in, without throwing, when the deployment is not configured", async () => {
    const member = await createVerifiedUser({ email: MEMBER, onboarded: true });
    setTestEnv({ DATABASE_URL: undefined });
    expect(await resolvePageAccess(withCookie(member.cookie), "/dashboard")).toEqual({
      kind: "redirect",
      to: "/sign-in",
    });
  });
});

describe("the proxy's cookie check against a real sign-in", () => {
  it("recognizes the cookie that a sign-in sets", async () => {
    const member = await createVerifiedUser({ email: MEMBER });
    const names = member.cookie.split("; ").map((pair) => pair.split("=")[0] ?? "");
    expect(hasSessionCookie(names)).toBe(true);
  });
});
