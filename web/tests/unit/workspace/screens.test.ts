import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { profileCard } from "@/components/dashboard/card-model";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { ProfileCard } from "@/components/dashboard/profile-card";
import { ProfileScreen } from "@/components/profile/profile-screen";
import type { ProfileDto } from "@/server/services/contracts";

import { NOW, OLD_CAPTURE, ONLY_FOLLOWERS_COMPLETE, profile } from "./support/profile";
import { badgeTexts, noticeTexts, renderScreen } from "./support/render";

/**
 * What the dashboard and a profile page say about the age of an export. The
 * export in most of these tests has its followers declared complete and its
 * following not, which makes its evidence status "degraded" at any age.
 */
const ZONE = "UTC";
const STALE_NOTE = "The current export was captured more than 36 hours ago. Import a newer export to refresh it.";
const UNDATED_NOTE =
  "The current export has no capture time, so its age is unknown. Import it again with its capture time, or import a newer export.";
const COVERAGE_NOTICE =
  "Warning: Coverage is incomplete. At least one direction is not complete, so some relationships and counts stay unknown.";

const cardOf = (overrides: Partial<ProfileDto>) =>
  profileCard(profile(overrides), { counts: null, lastProcessedAt: null, timeZone: ZONE, now: NOW });

const EMPTY_FEED = {
  query: { profileId: null, kind: null, status: null, q: "", page: 1 },
  page: { data: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } },
};

const dashboard = (...profiles: Array<Partial<ProfileDto>>) =>
  renderScreen(
    createElement(DashboardScreen, {
      timeZone: ZONE,
      cards: profiles.map(cardOf),
      quota: { used: profiles.length, limit: 3 },
      activity: EMPTY_FEED,
    }),
  );

type ProfileScreenProps = Parameters<typeof ProfileScreen>[0];

/** The profile header and notices, with no section open under them. */
function profilePage(overrides: Partial<ProfileDto>): string {
  const props: Omit<ProfileScreenProps, "children"> = {
    profile: profile(overrides),
    timeZone: ZONE,
    lastProcessedAt: null,
    tab: "relationships",
    now: NOW,
  };
  return renderScreen(createElement(ProfileScreen, props as ProfileScreenProps, null));
}

describe("a profile card", () => {
  const card = (overrides: Partial<ProfileDto>) =>
    renderScreen(createElement(ProfileCard, { card: cardOf(overrides), primaryImport: false }));

  it("says Stale next to Incomplete coverage for an old export with one direction not complete", () => {
    const html = card({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: OLD_CAPTURE });
    expect(badgeTexts(html)).toEqual(["Incomplete coverage", "Stale"]);
    expect(html).toContain(STALE_NOTE);
    // The count it qualifies is on the same card.
    expect(html).toContain("1,234");
  });

  it("says only Incomplete coverage while that export is recent", () => {
    const html = card(ONLY_FOLLOWERS_COMPLETE);
    expect(badgeTexts(html)).toEqual(["Incomplete coverage"]);
    expect(html).not.toContain(STALE_NOTE);
  });

  it("says Stale for an export without a capture time, and gives it no age", () => {
    const html = card({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: null });
    expect(badgeTexts(html)).toEqual(["Incomplete coverage", "Stale"]);
    expect(html).toContain(UNDATED_NOTE);
    expect(html).not.toContain("36 hours");
  });
});

describe("the dashboard", () => {
  it("raises the stale banner for an old export whose coverage is incomplete", () => {
    const html = dashboard({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: OLD_CAPTURE });
    expect(noticeTexts(html)).toContain(
      "Warning: One profile shows a stale export. atlas_studio: the current export is more than 36 hours old or has no capture time. The numbers describe that export, not today. Request a new export from Instagram and import it to refresh them.",
    );
  });

  it("raises no stale banner while every export is recent", () => {
    const html = dashboard(ONLY_FOLLOWERS_COMPLETE, { id: "0b7c2f4e-1d3a-4c5b-8e6f-7a8b9c0d1e2f", handle: "lunar_arch" });
    expect(noticeTexts(html).filter((text) => text.includes("stale"))).toEqual([]);
  });
});

describe("a profile page", () => {
  it("states that an old export is stale when its coverage is incomplete, next to the coverage notice", () => {
    const html = profilePage({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: OLD_CAPTURE });
    expect(badgeTexts(html)).toEqual(["Incomplete coverage", "Stale"]);
    const notices = noticeTexts(html);
    expect(notices).toContain(
      `Warning: The current export is stale. ${STALE_NOTE} The numbers below describe that export, not today.`,
    );
    expect(notices).toContain(COVERAGE_NOTICE);
  });

  it("states that an export without a capture time is stale, and gives it no age", () => {
    const html = profilePage({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: null });
    expect(badgeTexts(html)).toEqual(["Incomplete coverage", "Stale"]);
    expect(noticeTexts(html)).toContain(
      `Warning: The current export is stale. ${UNDATED_NOTE} The numbers below describe that export, not today.`,
    );
    expect(html).not.toContain("36 hours");
  });

  it("does not call a recent export with incomplete coverage stale", () => {
    const html = profilePage(ONLY_FOLLOWERS_COMPLETE);
    expect(badgeTexts(html)).toEqual(["Incomplete coverage"]);
    const notices = noticeTexts(html);
    expect(notices).toContain(COVERAGE_NOTICE);
    expect(notices.filter((text) => text.includes("stale"))).toEqual([]);
  });

  it("states a complete, old export as stale once, with no coverage notice", () => {
    const html = profilePage({ evidence: "stale", capturedAt: OLD_CAPTURE });
    expect(badgeTexts(html)).toEqual(["Stale"]);
    const notices = noticeTexts(html);
    expect(notices.filter((text) => text.includes("The current export is stale."))).toHaveLength(1);
    expect(notices).not.toContain(COVERAGE_NOTICE);
  });

  it("raises neither notice for a complete, recent export", () => {
    const html = profilePage({});
    expect(badgeTexts(html)).toEqual(["Current"]);
    expect(noticeTexts(html).filter((text) => /stale|Coverage is incomplete/.test(text))).toEqual([]);
  });
});
