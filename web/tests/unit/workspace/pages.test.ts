import { eq } from "drizzle-orm";
import { createElement, isValidElement, type ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(app)/dashboard/page";
import ImportPage, { generateMetadata as importMetadata } from "@/app/(app)/profiles/[id]/import/page";
import { loadOwnedProfile } from "@/app/(app)/profiles/[id]/load";
import ProfilePage, { generateMetadata as profileMetadata } from "@/app/(app)/profiles/[id]/page";
import ProfilesIndexPage from "@/app/(app)/profiles/page";
import { DashboardScreen, type DashboardScreenProps } from "@/components/dashboard/dashboard-screen";
import { workspaceUser } from "@/components/dashboard/workspace-access";
import { ImportFlow } from "@/components/import/import-flow";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { formatCaptureTime } from "@/domain/capture-time";
import { getDb } from "@/server/db/client";
import { profile, usageDaily, user } from "@/server/db/schema";
import { importExport } from "@/server/services/imports";
import { createProfile } from "@/server/services/profiles";
import { GLOBAL_SCOPE, utcDay } from "@/server/services/usage";

import { createVerifiedUser, resetDatabase, restoreTestEnv, setTestEnv, type VerifiedUser } from "../../helpers";
import { ATLAS, exportPayload, markDerived, NOVA, RANDOM_ID } from "../../integration/services/support";
import { startDatabase } from "./support/database";
import { badgeTexts, noticeTexts, renderScreen } from "./support/render";

/**
 * The workspace pages (dashboard, profile, import), called the way Next.js
 * calls them, by two accounts. The guards, the services, and the database are
 * the real ones. The one thing replaced is `headers()` from next/headers, which
 * only exists inside a request that Next.js is serving: here it returns the
 * headers of the visitor each test describes.
 *
 * What is pinned: a profile address answers the account that owns the profile
 * and nobody else; a foreign id, a missing id, and a malformed id end the same
 * way, on the not-found page; no title carries a handle for anyone but the
 * owner; and the dashboard shows the visitor's own entries whatever the
 * address says.
 *
 * This file is in tests/unit because that is where the workspace tests live.
 * It needs a database, so it starts its own (support/database.ts).
 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const visitor = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => visitor.headers }));

let stopDatabase: () => Promise<void>;
beforeAll(async () => {
  stopDatabase = await startDatabase();
});
beforeEach(async () => {
  visitor.headers = new Headers();
  await resetDatabase();
});
afterEach(restoreTestEnv);
afterAll(() => stopDatabase());

const visitAs = (cookie?: string, extra: Record<string, string> = {}) => {
  visitor.headers = new Headers({ ...(cookie ? { cookie } : {}), ...extra });
};

/** The three headers the proxy sets together on a request for this path (src/proxy.ts). */
const throughProxy = (pathname: string): Record<string, string> => ({
  "x-nonce": "test-nonce",
  "content-security-policy": "script-src 'self' 'nonce-test-nonce'",
  "x-orbitdiff-pathname": pathname,
});

/** What Next.js turns into the not-found page with status 404. */
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

type Outcome = { value: unknown } | { digest: string };

/** What a page or a title function ended in: its value, or the digest of the Next.js error it threw. */
async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await run() };
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") return { digest };
    throw error;
  }
}

/** The first element of this type inside what a page returned, whatever wraps it. */
function findElement<P>(node: unknown, type: (props: P) => unknown): ReactElement<P> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<P>;
  return findElement((node.props as { children?: unknown }).children, type);
}

function screenIn<P>(node: unknown, type: (props: P) => unknown): ReactElement<P> {
  const found = findElement(node, type);
  if (!found) throw new Error("the page did not render the expected screen");
  return found;
}

type ProfileScreenProps = Parameters<typeof ProfileScreen>[0];
type ImportFlowProps = Parameters<typeof ImportFlow>[0];

const address = (id: string, query: Record<string, string> = {}) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(query),
});

const dashboardScreen = async (query: Record<string, string> = {}) =>
  screenIn<DashboardScreenProps>(await DashboardPage({ searchParams: Promise.resolve(query) }), DashboardScreen);
const profileScreen = async (id: string) => screenIn<ProfileScreenProps>(await ProfilePage(address(id)), ProfileScreen);
const importFlow = async (id: string) => screenIn<ImportFlowProps>(await ImportPage(address(id)), ImportFlow);

/**
 * What a dashboard sends to the browser about the accounts it shows: the props
 * that travel with it, and the markup with the add-profile hint taken out.
 * That hint is fixed copy and names atlas_studio as its example for everyone.
 */
function sentBy(screen: ReactElement<DashboardScreenProps>): string {
  const markup = renderScreen(screen);
  const hint = /<p id="add-profile-handle-hint"[^>]*>[^<]*<\/p>/;
  if (!hint.test(markup)) throw new Error("the add-profile hint is not where this test expects it");
  return `${markup.replace(hint, "")}\n${JSON.stringify(screen.props)}`;
}

/** The profile header and notices. The section that streams in behind them is left out. */
const profileMarkup = (screen: ReactElement<ProfileScreenProps>) =>
  renderScreen(createElement(ProfileScreen, screen.props, null));

interface Account extends VerifiedUser {
  profileId: string;
}

/** Two onboarded accounts with one profile each: atlas_studio for the first, nova_labs for the second. */
async function twoAccounts(): Promise<{ atlas: Account; nova: Account }> {
  const atlas = await createVerifiedUser({ email: ATLAS, onboarded: true });
  const nova = await createVerifiedUser({ email: NOVA, onboarded: true });
  const atlasProfile = await createProfile(atlas.userId, "atlas_studio");
  const novaProfile = await createProfile(nova.userId, "nova_labs");
  return { atlas: { ...atlas, profileId: atlasProfile.id }, nova: { ...nova, profileId: novaProfile.id } };
}

/** Addresses that are not a profile of the second account: the first account's, one of nobody, and malformed ones. */
const notMine = (foreignId: string): Array<[string, string]> => [
  ["a profile id of another account", foreignId],
  ["a well-formed id of nothing", RANDOM_ID],
  ["a malformed id", "not-a-profile-id"],
  ["an id with something appended", `${foreignId}-x`],
  ["an empty id", ""],
];

describe("/profiles/[id]", () => {
  it("shows the owner their own profile, under its handle", async () => {
    const { atlas } = await twoAccounts();
    visitAs(atlas.cookie);
    const screen = await profileScreen(atlas.profileId);
    expect(screen.props.profile).toMatchObject({ id: atlas.profileId, handle: "atlas_studio" });
    expect(await profileMetadata(address(atlas.profileId))).toEqual({ title: "atlas_studio" });
    expect(profileMarkup(screen)).toContain("atlas_studio");
  });

  it("answers not found for every id that is not a profile of the visitor, and does not tell them apart", async () => {
    const { atlas, nova } = await twoAccounts();
    visitAs(nova.cookie);
    for (const [what, id] of notMine(atlas.profileId)) {
      expect(await outcomeOf(() => ProfilePage(address(id))), what).toEqual({ digest: NOT_FOUND });
      expect(await outcomeOf(() => ProfilePage(address(id, { tab: "imports" }))), what).toEqual({ digest: NOT_FOUND });
    }
  });

  it("gives no title for an id that is not a profile of the visitor, so the title never carries the handle", async () => {
    const { atlas, nova } = await twoAccounts();
    visitAs(nova.cookie);
    const outcomes: Outcome[] = [];
    for (const [what, id] of notMine(atlas.profileId)) {
      const outcome = await outcomeOf(() => profileMetadata(address(id)));
      expect(outcome, what).toEqual({ digest: NOT_FOUND });
      outcomes.push(outcome);
    }
    expect(JSON.stringify(outcomes)).not.toContain("atlas_studio");
  });

  it("still shows the visitor their own profile, and nothing of the other account", async () => {
    const { nova } = await twoAccounts();
    visitAs(nova.cookie);
    const screen = await profileScreen(nova.profileId);
    expect(screen.props.profile.handle).toBe("nova_labs");
    expect(`${profileMarkup(screen)}\n${JSON.stringify(screen.props)}`).not.toContain("atlas_studio");
  });

  it("sends a visitor who is not signed in to sign-in, for an id that exists and for one that does not", async () => {
    const { atlas } = await twoAccounts();
    visitAs();
    for (const id of [atlas.profileId, RANDOM_ID, "not-a-profile-id"]) {
      for (const run of [() => ProfilePage(address(id)), () => profileMetadata(address(id))]) {
        const outcome = await outcomeOf(run);
        expect(outcome).toEqual({ digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/sign-in;/) });
      }
    }
  });

  it("sends an owner who has not finished onboarding to onboarding", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    const created = await createProfile(atlas.userId, "atlas_studio");
    visitAs(atlas.cookie);
    expect(await outcomeOf(() => ProfilePage(address(created.id)))).toEqual({
      digest: expect.stringContaining(";/onboarding;"),
    });
  });

  it("renders nothing for a suspended owner, and gives the page a title without the handle", async () => {
    const { atlas } = await twoAccounts();
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, atlas.userId));
    visitAs(atlas.cookie);
    expect(await ProfilePage(address(atlas.profileId))).toBeNull();
    expect(await profileMetadata(address(atlas.profileId))).toEqual({ title: "Profile" });
  });
});

describe("/profiles/[id]/import", () => {
  it("gives the owner the import screen of their own profile", async () => {
    const { atlas } = await twoAccounts();
    visitAs(atlas.cookie);
    const flow = await importFlow(atlas.profileId);
    expect(flow.props).toMatchObject({ profileId: atlas.profileId, handle: "atlas_studio", snapshotCount: 0 });
    expect(await importMetadata({ params: Promise.resolve({ id: atlas.profileId }) })).toEqual({
      title: "Import an export",
    });
  });

  it("answers not found, page and title, for every id that is not a profile of the visitor", async () => {
    const { atlas, nova } = await twoAccounts();
    visitAs(nova.cookie);
    for (const [what, id] of notMine(atlas.profileId)) {
      const params = { params: Promise.resolve({ id }) };
      expect(await outcomeOf(() => ImportPage(params)), what).toEqual({ digest: NOT_FOUND });
      expect(await outcomeOf(() => importMetadata(params)), what).toEqual({ digest: NOT_FOUND });
    }
  });

  it("sends a visitor who is not signed in to sign-in", async () => {
    const { atlas } = await twoAccounts();
    visitAs();
    const outcome = await outcomeOf(() => ImportPage({ params: Promise.resolve({ id: atlas.profileId }) }));
    expect(outcome).toEqual({ digest: expect.stringMatching(/^NEXT_REDIRECT;[a-z]+;\/sign-in;/) });
  });
});

describe("loadOwnedProfile", () => {
  it("returns the session user and that user's profile, read with one clock", async () => {
    const { atlas } = await twoAccounts();
    visitAs(atlas.cookie);
    const before = Date.now();
    const owned = await loadOwnedProfile(atlas.profileId);
    expect(owned?.user.id).toBe(atlas.userId);
    expect(owned?.profile).toMatchObject({ id: atlas.profileId, handle: "atlas_studio" });
    expect(owned?.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(owned?.now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("ends in not found for a profile of another account", async () => {
    const { atlas, nova } = await twoAccounts();
    visitAs(nova.cookie);
    expect(await outcomeOf(() => loadOwnedProfile(atlas.profileId))).toEqual({ digest: NOT_FOUND });
  });
});

describe("/dashboard", () => {
  it("shows the visitor their own profiles and activity, and nothing of another account", async () => {
    const { atlas, nova } = await twoAccounts();
    await importExport(atlas.userId, atlas.profileId, exportPayload());
    visitAs(nova.cookie);
    const screen = await dashboardScreen();
    expect(screen.props.cards.map((card) => card.handle)).toEqual(["nova_labs"]);
    expect(screen.props.quota).toEqual({ used: 1, limit: 3 });
    expect(screen.props.activity.page.data.map((entry) => entry.profileHandle)).toEqual(["nova_labs"]);
    const sent = sentBy(screen);
    expect(sent).toContain("nova_labs");
    expect(sent).not.toContain("atlas_studio");
    expect(sent).not.toContain(atlas.profileId);
    expect(sent).not.toContain(ATLAS);
  });

  it("ignores a profile filter that names a profile of another account", async () => {
    const { atlas, nova } = await twoAccounts();
    await importExport(atlas.userId, atlas.profileId, exportPayload());
    visitAs(nova.cookie);
    const screen = await dashboardScreen({ profile: atlas.profileId });
    // The filter is dropped, so the feed is the visitor's whole feed.
    expect(screen.props.activity.query.profileId).toBeNull();
    expect(screen.props.activity.page.data.map((entry) => [entry.kind, entry.profileHandle])).toEqual([
      ["profile_added", "nova_labs"],
    ]);
    const sent = sentBy(screen);
    expect(sent).not.toContain("atlas_studio");
    expect(sent).not.toContain(atlas.profileId);
  });

  it("ignores a profile filter that names nothing, or is malformed, without failing the page", async () => {
    const { nova } = await twoAccounts();
    visitAs(nova.cookie);
    for (const profile of [RANDOM_ID, "not-a-profile-id", ""]) {
      const screen = await dashboardScreen({ profile });
      expect(screen.props.activity.query.profileId, profile).toBeNull();
      expect(screen.props.activity.page.data).toHaveLength(1);
    }
  });

  it("keeps a profile filter that names one of the visitor's own profiles", async () => {
    const { nova } = await twoAccounts();
    const second = await createProfile(nova.userId, "pixel_forge");
    visitAs(nova.cookie);
    const screen = await dashboardScreen({ profile: second.id });
    expect(screen.props.activity.query.profileId).toBe(second.id);
    expect(screen.props.activity.page.data.map((entry) => entry.profileHandle)).toEqual(["pixel_forge"]);
  });

  it("sends a visitor who is not signed in to sign-in, remembering the page the proxy reported", async () => {
    await twoAccounts();
    visitAs(undefined, throughProxy("/dashboard"));
    expect(await outcomeOf(() => DashboardPage({ searchParams: Promise.resolve({}) }))).toEqual({
      digest: expect.stringContaining(";/sign-in?next=%2Fdashboard;"),
    });
  });

  it("sends an account that has not finished onboarding to onboarding", async () => {
    const atlas = await createVerifiedUser({ email: ATLAS });
    visitAs(atlas.cookie);
    expect(await outcomeOf(() => DashboardPage({ searchParams: Promise.resolve({}) }))).toEqual({
      digest: expect.stringContaining(";/onboarding;"),
    });
  });

  it("renders nothing for a suspended account: the layout shows the notice in its place", async () => {
    const { atlas } = await twoAccounts();
    await getDb().update(user).set({ status: "suspended" }).where(eq(user.id, atlas.userId));
    visitAs(atlas.cookie);
    expect(await DashboardPage({ searchParams: Promise.resolve({}) })).toBeNull();
  });
});

describe("/profiles", () => {
  it("leads a signed-in account to the dashboard and a visitor to sign-in", async () => {
    const { atlas } = await twoAccounts();
    visitAs(atlas.cookie);
    expect(await outcomeOf(ProfilesIndexPage)).toEqual({ digest: expect.stringContaining(";/dashboard;") });
    visitAs();
    expect(await outcomeOf(ProfilesIndexPage)).toEqual({ digest: expect.stringContaining(";/sign-in;") });
  });
});

describe("workspaceUser", () => {
  it("returns the user of the session, read from the database", async () => {
    const { nova } = await twoAccounts();
    visitAs(nova.cookie);
    expect(await workspaceUser()).toMatchObject({ id: nova.userId, email: NOVA });
  });

  it("is not opened by a forged session cookie or by a header that names a user", async () => {
    const { atlas } = await twoAccounts();
    const attempts: Array<Record<string, string>> = [
      { cookie: "better-auth.session_token=forged.value" },
      { "x-user-id": atlas.userId, "x-user-email": ATLAS },
    ];
    for (const headers of attempts) {
      visitor.headers = new Headers(headers);
      expect(await outcomeOf(workspaceUser)).toEqual({ digest: expect.stringContaining(";/sign-in;") });
    }
  });

  it("does not take the page to return to from a request that did not come through the proxy", async () => {
    await twoAccounts();
    // The path header alone is whatever the client chose to send.
    visitAs(undefined, { "x-orbitdiff-pathname": "/profiles/from-the-client" });
    expect(await outcomeOf(workspaceUser)).toEqual({ digest: expect.stringMatching(/;\/sign-in;/) });
  });
});

describe("a stale export, from the import to the page", () => {
  const OLD = "2026-06-01T12:00:00+00:00";

  /** An import with the followers declared complete and the following not. */
  async function importOnlyFollowersComplete(capturedAt: string): Promise<Account> {
    const { atlas } = await twoAccounts();
    await importExport(atlas.userId, atlas.profileId, exportPayload({ capturedAt, completeFollowing: false }));
    await markDerived(atlas.profileId, { at: new Date() });
    visitAs(atlas.cookie);
    return atlas;
  }

  it("is marked stale on the dashboard although one direction is not declared complete", async () => {
    await importOnlyFollowersComplete(OLD);
    const screen = await dashboardScreen();
    const [card] = screen.props.cards;
    expect(card).toMatchObject({ handle: "atlas_studio", stale: true });
    expect(card?.badges.map((badge) => badge.text)).toEqual(["Incomplete coverage", "Stale"]);
    // The count of the complete direction is shown, which is why its age has to be.
    expect(card?.stats[0]).toEqual({ key: "followers", label: "Followers", value: 1 });
    expect(noticeTexts(renderScreen(screen)).some((text) => text.includes("One profile shows a stale export."))).toBe(
      true,
    );
  });

  it("is marked stale on the profile page although one direction is not declared complete", async () => {
    const atlas = await importOnlyFollowersComplete(OLD);
    const screen = await profileScreen(atlas.profileId);
    expect(screen.props.profile.evidence).toBe("degraded");
    const html = profileMarkup(screen);
    expect(badgeTexts(html)).toEqual(["Incomplete coverage", "Stale"]);
    const notices = noticeTexts(html);
    expect(notices.some((text) => text.startsWith("Warning: The current export is stale."))).toBe(true);
    expect(notices.some((text) => text.startsWith("Warning: Coverage is incomplete."))).toBe(true);
  });

  it("is not marked stale while the export is an hour old", async () => {
    const atlas = await importOnlyFollowersComplete(formatCaptureTime(new Date(Date.now() - 3_600_000)));
    const dashboard = await dashboardScreen();
    expect(dashboard.props.cards[0]).toMatchObject({ handle: "atlas_studio", stale: false });
    expect(noticeTexts(renderScreen(dashboard)).filter((text) => text.includes("stale"))).toEqual([]);
    const html = profileMarkup(await profileScreen(atlas.profileId));
    expect(badgeTexts(html)).toEqual(["Incomplete coverage"]);
    expect(noticeTexts(html).filter((text) => text.includes("stale"))).toEqual([]);
  });
});

describe("scheduled reviews that are paused or overdue", () => {
  const HOUR = 3_600_000;

  /** Use up the day's job capacity, as the batch run would once CAPACITY_MAX_JOBS_PER_DAY jobs started. */
  async function useUpJobCapacity(): Promise<void> {
    setTestEnv({ CAPACITY_MAX_JOBS_PER_DAY: "1" });
    await getDb().insert(usageDaily).values({ day: utcDay(new Date()), scopeKey: GLOBAL_SCOPE, jobs: 1 });
  }

  async function dueAnHourAgo(profileId: string): Promise<void> {
    await getDb().update(profile).set({ nextReviewAt: new Date(Date.now() - HOUR) }).where(eq(profile.id, profileId));
  }

  const pausedNotice = (html: string) =>
    noticeTexts(html).find((text) => text.includes("Scheduled reviews are paused")) ?? null;

  it("says on the dashboard that scheduled reviews are paused, why, and when they resume", async () => {
    const { atlas } = await twoAccounts();
    await dueAnHourAgo(atlas.profileId);
    await useUpJobCapacity();
    visitAs(atlas.cookie);

    const html = renderScreen(await dashboardScreen());

    expect(pausedNotice(html)).toContain("The service reached its daily job capacity.");
    expect(html).toContain("Paused until");
    expect(html).not.toContain("Overdue since");
  });

  it("says it on the profile page as well", async () => {
    const { atlas } = await twoAccounts();
    await useUpJobCapacity();
    visitAs(atlas.cookie);

    const html = profileMarkup(await profileScreen(atlas.profileId));

    expect(pausedNotice(html)).toContain("The service reached its daily job capacity.");
    expect(html).toContain("Paused until");
  });

  it("calls a review time that has passed overdue, on the dashboard and on the profile page", async () => {
    const { atlas } = await twoAccounts();
    await dueAnHourAgo(atlas.profileId);
    visitAs(atlas.cookie);

    expect(renderScreen(await dashboardScreen())).toContain("Overdue since");
    const html = profileMarkup(await profileScreen(atlas.profileId));
    expect(html).toContain("Overdue since");
    expect(pausedNotice(html)).toBeNull();
  });
});
