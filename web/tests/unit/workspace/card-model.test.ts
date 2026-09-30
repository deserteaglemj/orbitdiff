import { describe, expect, it } from "vitest";

import {
  countSeries,
  coverageDetail,
  coverageText,
  evidenceBadge,
  exportAge,
  profileCard,
  profileQuota,
  sourceLine,
  staleBanner,
} from "@/components/dashboard/card-model";
import type { CountHistoryDto, ProfileDto } from "@/server/services/contracts";

import { coverage, NOW, OLD_CAPTURE, ONLY_FOLLOWERS_COMPLETE, profile } from "./support/profile";

const ZONE = "America/Chicago";

const NO_EXTRAS = { counts: null, lastProcessedAt: null, timeZone: ZONE, now: NOW };

describe("evidenceBadge", () => {
  it("states each evidence status in words", () => {
    expect(evidenceBadge("missing")).toEqual({ tone: "neutral", text: "No evidence yet" });
    expect(evidenceBadge("degraded")).toEqual({ tone: "warning", text: "Incomplete coverage" });
    expect(evidenceBadge("stale")).toEqual({ tone: "warning", text: "Stale" });
    expect(evidenceBadge("ok")).toEqual({ tone: "ok", text: "Current" });
  });
});

describe("sourceLine", () => {
  it("names the owner export and its capture time in the user's timezone", () => {
    expect(sourceLine(profile(), ZONE)).toBe("Owner export, captured 29 Sep 2026, 12:00 (America/Chicago)");
  });

  it("says that the capture time was not recorded for an undated export", () => {
    expect(sourceLine(profile({ capturedAt: null }), ZONE)).toBe("Owner export, capture time not recorded");
  });

  it("says that there is no import yet", () => {
    expect(sourceLine(profile({ currentSnapshotId: null, capturedAt: null }), ZONE)).toBe("No import yet");
  });
});

describe("coverage wording", () => {
  it("calls complete coverage declared by you, never verified", () => {
    expect(coverageDetail(coverage())).toBe("Complete, declared by you");
    expect(coverageText({ followers: coverage(), following: coverage() })).toBe(
      "Followers: complete, declared by you. Following: complete, declared by you.",
    );
  });

  it("gives the reason a present direction is only partial", () => {
    expect(coverageDetail(coverage({ complete: false, declaredComplete: false }))).toBe(
      "Partial: not declared complete",
    );
    expect(coverageDetail(coverage({ complete: false, capturedAtKnown: false }))).toBe("Partial: no capture time");
    expect(coverageDetail(coverage({ complete: false, shards: [1, 3], shardsContiguous: false }))).toBe(
      "Partial: numbered files are missing",
    );
    expect(
      coverageDetail(coverage({ complete: false, declaredComplete: false, capturedAtKnown: false })),
    ).toBe("Partial: not declared complete, no capture time");
  });

  it("says when a direction was not supplied", () => {
    expect(coverageDetail(coverage({ present: false, complete: false, shards: [], shardsContiguous: false }))).toBe(
      "Not supplied",
    );
    expect(
      coverageText({
        followers: coverage(),
        following: coverage({ present: false, complete: false, shards: [], shardsContiguous: false }),
      }),
    ).toBe("Followers: complete, declared by you. Following: not supplied.");
  });

  it("has no coverage to describe before the first processed import", () => {
    expect(coverageText(null)).toBeNull();
  });
});

describe("profileCard", () => {
  it("shows the counts the coverage supports", () => {
    const card = profileCard(profile(), NO_EXTRAS);
    expect(card.stats).toEqual([
      { key: "followers", label: "Followers", value: 2 },
      { key: "following", label: "Following", value: 3 },
      { key: "mutuals", label: "Mutuals", value: 1 },
      { key: "notFollowingBack", label: "Not following back", value: 2 },
    ]);
    expect(card.badges).toEqual([{ tone: "ok", text: "Current" }]);
    expect(card.profileHref).toBe("/profiles/3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b");
    expect(card.importHref).toBe("/profiles/3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b/import");
  });

  it("leaves a count unknown when its coverage is not complete, never zero", () => {
    const card = profileCard(
      profile({
        evidence: "degraded",
        metrics: {
          followers: null,
          following: 3,
          mutuals: 1,
          notFollowingBack: null,
          followersObserved: 2,
          followingObserved: 3,
          reciprocalUnknown: 2,
        },
      }),
      NO_EXTRAS,
    );
    expect(card.stats.map((stat) => stat.value)).toEqual([null, 3, 1, null]);
  });

  it("has only unknown counts before anything was imported", () => {
    const card = profileCard(
      profile({
        evidence: "missing",
        currentSnapshotId: null,
        capturedAt: null,
        lastImportAt: null,
        snapshotCount: 0,
        coverage: null,
        coverageLabel: null,
        metrics: null,
        lastSuccessAt: null,
      }),
      NO_EXTRAS,
    );
    expect(card.stats.map((stat) => stat.value)).toEqual([null, null, null, null]);
    expect(card.sourceLine).toBe("No import yet");
    expect(card.coverage).toBeNull();
    expect(card.hasImport).toBe(false);
    expect(card.badges).toEqual([{ tone: "neutral", text: "No evidence yet" }]);
    expect(card.stale).toBe(false);
  });

  it("lists the times in the user's timezone", () => {
    const card = profileCard(profile({ lastReviewAt: "2026-09-30T14:00:03.000Z" }), {
      counts: null,
      lastProcessedAt: "2026-09-29T18:00:05.000Z",
      timeZone: ZONE,
      now: NOW,
    });
    expect(card.facts).toEqual([
      { label: "Last processed import", value: "29 Sep 2026, 13:00 (America/Chicago)" },
      { label: "Last successful review", value: "30 Sep 2026, 09:00 (America/Chicago)" },
      { label: "Next scheduled review", value: "1 Oct 2026, 09:00 (America/Chicago)" },
    ]);
  });

  it("says None yet for times that have not happened", () => {
    const card = profileCard(profile(), NO_EXTRAS);
    expect(card.facts[0]).toEqual({ label: "Last processed import", value: "None yet" });
    expect(card.facts[1]).toEqual({ label: "Last successful review", value: "None yet" });
  });

  it("has a processing state while an import waits for its derived data", () => {
    expect(profileCard(profile(), NO_EXTRAS).processing).toBeNull();
    const card = profileCard(profile({ processing: true }), NO_EXTRAS);
    expect(card.processing?.title).toBe("Processing import");
    expect(card.processing?.detail).toContain("last processed result");
  });

  it("shows a failure and the last success as two separate statements", () => {
    const card = profileCard(
      profile({
        lastSuccessAt: "2026-09-29T18:00:05.000Z",
        lastFailureAt: "2026-09-30T15:00:00.000Z",
        lastFailureCode: "handler_error",
      }),
      NO_EXTRAS,
    );
    expect(card.failure).toEqual({
      title: "The last background job failed",
      failed: "Failed on 30 Sep 2026, 10:00 (America/Chicago). Reason code: handler_error.",
      lastSuccess: "Last successful result: 29 Sep 2026, 13:00 (America/Chicago). It is unchanged.",
    });
    // The last good numbers stay on the card next to the failure.
    expect(card.stats.map((stat) => stat.value)).toEqual([2, 3, 1, 2]);
  });

  it("says so when a failure has no earlier success", () => {
    const card = profileCard(
      profile({ lastSuccessAt: null, lastFailureAt: "2026-09-30T15:00:00.000Z", lastFailureCode: null }),
      NO_EXTRAS,
    );
    expect(card.failure?.failed).toBe("Failed on 30 Sep 2026, 10:00 (America/Chicago).");
    expect(card.failure?.lastSuccess).toBe("There is no earlier successful result.");
  });

  it("does not report a failure that a later job has succeeded after", () => {
    const card = profileCard(
      profile({ lastSuccessAt: "2026-09-30T16:00:00.000Z", lastFailureAt: "2026-09-30T15:00:00.000Z" }),
      NO_EXTRAS,
    );
    expect(card.failure).toBeNull();
  });

  it("has a paused state with the reason and no next review", () => {
    const card = profileCard(
      profile({ status: "paused", pausedAt: "2026-09-30T15:00:00.000Z", nextReviewAt: null }),
      NO_EXTRAS,
    );
    expect(card.paused).toEqual({
      title: "Scheduled reviews are paused",
      detail: "You paused this profile on 30 Sep 2026, 10:00 (America/Chicago). Stored imports are unchanged.",
    });
    expect(card.facts[2]).toEqual({ label: "Next scheduled review", value: "Paused" });
    expect(profileCard(profile(), NO_EXTRAS).paused).toBeNull();
  });

  describe("a stale export", () => {
    const STALE_NOTE = "The current export was captured more than 36 hours ago. Import a newer export to refresh it.";
    const DEGRADED_NOTE = "At least one direction is not complete, so some relationships and counts stay unknown.";

    it("is marked stale when both directions are complete", () => {
      const card = profileCard(profile({ evidence: "stale", capturedAt: OLD_CAPTURE }), NO_EXTRAS);
      expect(card.stale).toBe(true);
      expect(card.badges).toEqual([{ tone: "warning", text: "Stale" }]);
      expect(card.notes).toEqual([STALE_NOTE]);
    });

    it("is marked stale when its coverage is incomplete, next to the coverage statement", () => {
      const card = profileCard(profile({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: OLD_CAPTURE }), NO_EXTRAS);
      expect(card.stale).toBe(true);
      expect(card.badges).toEqual([
        { tone: "warning", text: "Incomplete coverage" },
        { tone: "warning", text: "Stale" },
      ]);
      expect(card.notes).toEqual([DEGRADED_NOTE, STALE_NOTE]);
      // The count of the complete direction is still shown, which is why its age has to be stated.
      expect(card.stats[0]).toEqual({ key: "followers", label: "Followers", value: 1234 });
    });

    it("is not marked stale while an export with incomplete coverage is within the limit", () => {
      const card = profileCard(profile(ONLY_FOLLOWERS_COMPLETE), NO_EXTRAS);
      expect(card.stale).toBe(false);
      expect(card.badges).toEqual([{ tone: "warning", text: "Incomplete coverage" }]);
      expect(card.notes).toEqual([DEGRADED_NOTE]);
    });

    it("is marked stale when it has no capture time, without claiming an age", () => {
      const card = profileCard(profile({ ...ONLY_FOLLOWERS_COMPLETE, capturedAt: null }), NO_EXTRAS);
      expect(card.stale).toBe(true);
      expect(card.badges.map((badge) => badge.text)).toEqual(["Incomplete coverage", "Stale"]);
      expect(card.notes).toEqual([
        DEGRADED_NOTE,
        "The current export has no capture time, so its age is unknown. Import it again with its capture time, or import a newer export.",
      ]);
      expect(card.notes.join(" ")).not.toContain("36 hours");
    });

    it("is not marked for a current export", () => {
      const card = profileCard(profile(), NO_EXTRAS);
      expect(card.stale).toBe(false);
      expect(card.notes).toEqual([
        "Both directions are complete and the export was captured within the last 36 hours.",
      ]);
    });

    it("keeps the Stale badge the service decided, even when the clock of the page disagrees", () => {
      const card = profileCard(profile({ evidence: "stale" }), NO_EXTRAS);
      expect(card.stale).toBe(true);
      expect(card.badges).toEqual([{ tone: "warning", text: "Stale" }]);
      expect(card.notes).toEqual([STALE_NOTE]);
    });
  });

  describe("count trend", () => {
    const history: CountHistoryDto = {
      points: [
        { snapshotId: "a", capturedAt: "2026-09-20T17:00:00+00:00", followers: 2, following: 3 },
        { snapshotId: "b", capturedAt: "2026-09-27T17:00:00+00:00", followers: 3, following: 3 },
      ],
      followersChange: "Net growth of 1",
      followingChange: "No net change",
    };

    it("draws the follower counts when two dated complete snapshots exist", () => {
      const card = profileCard(profile(), { ...NO_EXTRAS, counts: history });
      expect(card.trend).toEqual({
        label: "Followers",
        points: [
          { label: "20 Sep 2026", value: 2 },
          { label: "27 Sep 2026", value: 3 },
        ],
      });
    });

    it("repeats the net change wording of the service and attaches no names", () => {
      const card = profileCard(profile(), { ...NO_EXTRAS, counts: history });
      expect(card.netChanges).toEqual([
        { label: "Followers", text: "Net growth of 1" },
        { label: "Following", text: "No net change" },
      ]);
    });

    it("has no trend with a single point", () => {
      const single: CountHistoryDto = { points: [history.points[0]], followersChange: null, followingChange: null };
      const card = profileCard(profile(), { ...NO_EXTRAS, counts: single });
      expect(card.trend).toBeNull();
      expect(card.netChanges).toEqual([]);
    });

    it("falls back to the following counts when the follower counts are unknown", () => {
      const following: CountHistoryDto = {
        points: history.points.map((point) => ({ ...point, followers: null })),
        followersChange: null,
        followingChange: "No net change",
      };
      const card = profileCard(profile(), { ...NO_EXTRAS, counts: following });
      expect(card.trend?.label).toBe("Following");
      expect(card.trend?.points.map((point) => point.value)).toEqual([3, 3]);
    });
  });
});

describe("countSeries", () => {
  const history: CountHistoryDto = {
    points: [
      { snapshotId: "a", capturedAt: "2026-09-20T17:00:00+00:00", followers: 2, following: null },
      { snapshotId: "b", capturedAt: "2026-09-27T17:00:00+00:00", followers: 3, following: 3 },
    ],
    followersChange: "Net growth of 1",
    followingChange: null,
  };

  it("is the known counts of one direction, oldest first, labelled with the capture date", () => {
    expect(countSeries(history, "followers", ZONE)).toEqual([
      { label: "20 Sep 2026", value: 2 },
      { label: "27 Sep 2026", value: 3 },
    ]);
  });

  it("leaves out a point whose count is unknown instead of drawing it as zero", () => {
    expect(countSeries(history, "following", ZONE)).toEqual([{ label: "27 Sep 2026", value: 3 }]);
  });
});

describe("exportAge", () => {
  const at = (capturedAt: string | null, currentSnapshotId: string | null = "9d1f6a52-0c3b-4f7e-8a21-5b6c7d8e9f01") =>
    exportAge({ currentSnapshotId, capturedAt }, NOW);

  it("is decided by the capture time and the clock alone", () => {
    expect(at("2026-09-30T11:00:00+00:00")).toBe("fresh");
    expect(at("2026-06-01T12:00:00+00:00")).toBe("stale");
  });

  it("turns stale after 36 hours, not at 36 hours", () => {
    expect(at("2026-09-29T00:00:00+00:00")).toBe("fresh");
    expect(at("2026-09-28T23:59:59+00:00")).toBe("stale");
  });

  it("is undated for an export without a capture time", () => {
    expect(at(null)).toBe("undated");
  });

  it("is none before the first import", () => {
    expect(at(null, null)).toBe("none");
  });
});

describe("staleBanner", () => {
  const card = (handle: string, overrides: Partial<ProfileDto> = {}) =>
    profileCard(profile({ handle, ...overrides }), NO_EXTRAS);

  it("names every profile whose export is stale, whatever its coverage", () => {
    const banner = staleBanner([
      card("atlas_studio", { evidence: "stale", capturedAt: "2026-09-01T12:00:00+00:00" }),
      card("lunar_arch"),
      card("ember_lab", { evidence: "degraded", capturedAt: "2026-06-01T12:00:00+00:00" }),
      card("nova_labs", { evidence: "degraded", capturedAt: null }),
    ]);
    expect(banner).toEqual({
      title: "3 profiles show a stale export.",
      detail:
        "atlas_studio, ember_lab, nova_labs: the current export is more than 36 hours old or has no capture time. The numbers describe that export, not today. Request a new export from Instagram and import it to refresh them.",
    });
  });

  it("counts a single profile in words", () => {
    expect(staleBanner([card("ember_lab", { evidence: "degraded", capturedAt: "2026-06-01T12:00:00+00:00" })])?.title).toBe(
      "One profile shows a stale export.",
    );
  });

  it("is absent when no export is stale", () => {
    expect(staleBanner([card("atlas_studio"), card("lunar_arch", { evidence: "degraded" })])).toBeNull();
    expect(staleBanner([])).toBeNull();
  });
});

describe("profileQuota", () => {
  it("states how many profiles are used", () => {
    expect(profileQuota(1, 3)).toEqual({ text: "1 of 3 profiles used.", full: false });
  });

  it("says why adding is paused at the limit", () => {
    expect(profileQuota(3, 3)).toEqual({
      text: "3 of 3 profiles used. Remove a profile to add another.",
      full: true,
    });
  });
});
