import { describe, expect, it } from "vitest";

import {
  changeRow,
  changesState,
  countRows,
  EVENT_TYPE_OPTIONS,
  observedInterval,
  PROFILE_TABS,
  readTab,
  RELATIONSHIP_OPTIONS,
  relationshipRow,
  removalDescription,
  snapshotRow,
  tabHref,
  triState,
} from "@/components/profile/rows";
import type {
  CountHistoryDto,
  CoverageDto,
  ExportEventDto,
  ExportEventType,
  SnapshotDto,
} from "@/server/services/contracts";

const ZONE = "America/Chicago";
const PROFILE = "3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b";
const EM_DASH = String.fromCharCode(0x2014);

function coverage(overrides: Partial<CoverageDto> = {}): CoverageDto {
  return {
    present: true,
    complete: true,
    declaredComplete: true,
    shards: [0],
    shardsContiguous: true,
    capturedAtKnown: true,
    independentlyVerified: false,
    ...overrides,
  };
}

function event(type: ExportEventType, username: string): ExportEventDto {
  return {
    id: `e-${username}`,
    profileId: PROFILE,
    profileHandle: "atlas_studio",
    type,
    direction: type.startsWith("follower_") ? "followers" : "following",
    username,
    intervalStart: "2026-09-20T17:00:00+00:00",
    intervalEnd: "2026-09-27T17:00:00+00:00",
    evidence: "export_observation",
  };
}

describe("triState", () => {
  it("renders Yes, No, and Unknown, and never turns unknown into No", () => {
    expect(triState(true)).toBe("Yes");
    expect(triState(false)).toBe("No");
    expect(triState(null)).toBe("Unknown");
  });
});

describe("relationshipRow", () => {
  it("states both directions and the relationship in words", () => {
    expect(
      relationshipRow({ username: "nova_labs", following: true, followedBy: true, relationship: "mutual" }),
    ).toEqual({ username: "nova_labs", youFollow: "Yes", followsYou: "Yes", relationship: "Mutual" });
    expect(
      relationshipRow({
        username: "pixel_forge",
        following: true,
        followedBy: false,
        relationship: "not_following_back",
      }),
    ).toEqual({ username: "pixel_forge", youFollow: "Yes", followsYou: "No", relationship: "Not following back" });
  });

  it("keeps a direction without complete coverage unknown", () => {
    expect(
      relationshipRow({ username: "lunar_arch", following: true, followedBy: null, relationship: "unknown" }),
    ).toEqual({ username: "lunar_arch", youFollow: "Yes", followsYou: "Unknown", relationship: "Unknown" });
  });

  it("offers every relationship as a filter, after an option for all", () => {
    expect(RELATIONSHIP_OPTIONS).toEqual([
      { value: "", label: "All relationships" },
      { value: "mutual", label: "Mutual" },
      { value: "not_following_back", label: "Not following back" },
      { value: "follows_you", label: "You do not follow back" },
      { value: "unknown", label: "Unknown" },
    ]);
  });
});

describe("observedInterval", () => {
  it("reads Observed in your export between the two capture times, in the user's timezone", () => {
    expect(observedInterval("2026-09-20T17:00:00+00:00", "2026-09-27T17:00:00+00:00", ZONE)).toBe(
      "Observed in your export between 20 Sep 2026, 12:00 and 27 Sep 2026, 12:00 (America/Chicago)",
    );
  });
});

describe("changeRow", () => {
  it("describes a difference between two exports and labels it an export observation", () => {
    expect(changeRow(event("follower_observed_added", "nova_labs"), ZONE)).toEqual({
      id: "e-nova_labs",
      username: "nova_labs",
      difference: "New in followers list",
      observed: "Observed in your export between 20 Sep 2026, 12:00 and 27 Sep 2026, 12:00 (America/Chicago)",
      evidence: "Export observation",
    });
  });

  it("words every type as a difference between lists", () => {
    expect(changeRow(event("follower_observed_removed", "pixel_forge"), ZONE).difference).toBe(
      "Gone from followers list",
    );
    expect(changeRow(event("following_observed_added", "ember_lab"), ZONE).difference).toBe("New in following list");
    expect(changeRow(event("following_observed_removed", "ember_lab"), ZONE).difference).toBe(
      "Gone from following list",
    );
  });

  it("never claims a follow, an unfollow, or a moment in time", () => {
    const types: ExportEventType[] = [
      "follower_observed_added",
      "follower_observed_removed",
      "following_observed_added",
      "following_observed_removed",
    ];
    const text = [
      ...types.flatMap((type) => Object.values(changeRow(event(type, "nova_labs"), ZONE))),
      ...EVENT_TYPE_OPTIONS.map((option) => option.label),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of ["unfollow", "followed", "automatic", "real-time", "real time", "live", "confirmed"]) {
      expect(text, word).not.toContain(word);
    }
    expect(text).not.toContain(EM_DASH);
  });

  it("offers every type as a filter, after an option for all", () => {
    expect(EVENT_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      "",
      "follower_observed_added",
      "follower_observed_removed",
      "following_observed_added",
      "following_observed_removed",
    ]);
    expect(EVENT_TYPE_OPTIONS[0].label).toBe("All differences");
  });
});

describe("changesState", () => {
  const range = { first: "2026-09-20T17:00:00+00:00", last: "2026-09-27T17:00:00+00:00" };

  it("asks for an import when there is none", () => {
    expect(changesState({ snapshots: 0, dated: 0, events: 0, filtered: false, ...range, timeZone: ZONE }).kind).toBe(
      "no_import",
    );
  });

  it("explains that undated imports cannot be compared", () => {
    const state = changesState({ snapshots: 1, dated: 0, events: 0, filtered: false, first: null, last: null, timeZone: ZONE });
    expect(state.kind).toBe("undated");
    expect(state.detail).toContain("capture time");
  });

  it("has an explicit baseline state with no change entries", () => {
    expect(
      changesState({ snapshots: 1, dated: 1, events: 0, filtered: false, first: range.first, last: range.first, timeZone: ZONE }),
    ).toEqual({
      kind: "baseline",
      title: "Nothing to compare yet",
      detail: "Baseline stored. Import a later export to see differences.",
    });
  });

  it("says that nothing was observed between two dated exports, with the interval", () => {
    const state = changesState({ snapshots: 2, dated: 2, events: 0, filtered: false, ...range, timeZone: ZONE });
    expect(state.kind).toBe("none_observed");
    expect(state.detail).toContain(
      "observed in your export between 20 Sep 2026, 12:00 and 27 Sep 2026, 12:00 (America/Chicago)",
    );
  });

  it("tells a filter without matches from a history without differences", () => {
    expect(changesState({ snapshots: 2, dated: 2, events: 0, filtered: true, ...range, timeZone: ZONE }).kind).toBe(
      "no_match",
    );
  });

  it("does not report on differences while the newest import is still being processed", () => {
    const state = changesState({
      snapshots: 2,
      dated: 2,
      events: 0,
      filtered: false,
      ...range,
      timeZone: ZONE,
      processing: true,
    });
    expect(state.kind).toBe("pending");
    expect(state.detail).toContain("when processing finishes");
  });

  it("is a list as soon as there are observations to show", () => {
    expect(changesState({ snapshots: 2, dated: 2, events: 2, filtered: false, ...range, timeZone: ZONE }).kind).toBe(
      "list",
    );
  });
});

describe("snapshotRow", () => {
  const snapshot: SnapshotDto = {
    id: "s1",
    capturedAt: "2026-09-20T17:00:00+00:00",
    importedAt: "2026-09-29T18:00:00.000Z",
    isCurrent: true,
    coverage: { followers: coverage({ shards: [1] }), following: coverage() },
    followers: 2,
    following: 3,
    followersObserved: 2,
    followingObserved: 3,
    source: "instagram_export",
  };

  it("shows the capture time, the import time, the coverage, the counts, and the current marker", () => {
    expect(snapshotRow(snapshot, ZONE)).toEqual({
      id: "s1",
      captured: "20 Sep 2026, 12:00 (America/Chicago)",
      imported: "29 Sep 2026, 13:00 (America/Chicago)",
      followersCoverage: "Complete, declared by you",
      followingCoverage: "Complete, declared by you",
      followers: "2",
      following: "3",
      current: true,
    });
  });

  it("says Not recorded for an undated import and Unknown for a count the coverage does not support", () => {
    const undated = snapshotRow(
      {
        ...snapshot,
        capturedAt: null,
        isCurrent: false,
        coverage: {
          followers: coverage({ complete: false, capturedAtKnown: false }),
          following: coverage({ present: false, complete: false, shards: [], shardsContiguous: false }),
        },
        followers: null,
        following: null,
        followingObserved: null,
      },
      ZONE,
    );
    expect(undated.captured).toBe("Not recorded");
    expect(undated.followers).toBe("Unknown (2 usernames in the file)");
    expect(undated.following).toBe("Unknown");
    expect(undated.followingCoverage).toBe("Not supplied");
    expect(undated.current).toBe(false);
  });
});

describe("countRows", () => {
  const history: CountHistoryDto = {
    points: [
      { snapshotId: "a", capturedAt: "2026-09-20T17:00:00+00:00", followers: 2, following: null },
      { snapshotId: "b", capturedAt: "2026-09-27T17:00:00+00:00", followers: 3, following: 3 },
    ],
    followersChange: "Net growth of 1",
    followingChange: null,
  };

  it("lists the newest point first with counts or Unknown, and nothing but numbers", () => {
    expect(countRows(history, ZONE)).toEqual([
      { id: "b", captured: "27 Sep 2026, 12:00 (America/Chicago)", followers: "3", following: "3" },
      { id: "a", captured: "20 Sep 2026, 12:00 (America/Chicago)", followers: "2", following: "Unknown" },
    ]);
  });
});

describe("tabs", () => {
  it("has the five sections in order", () => {
    expect(PROFILE_TABS.map((tab) => tab.label)).toEqual([
      "Relationships",
      "Changes",
      "Import history",
      "Counts",
      "Activity",
    ]);
  });

  it("opens Relationships unless the address names another section", () => {
    expect(readTab(undefined)).toBe("relationships");
    expect(readTab("changes")).toBe("changes");
    expect(readTab("everything")).toBe("relationships");
  });

  it("links to a section of the profile", () => {
    expect(tabHref(PROFILE, "relationships")).toBe(`/profiles/${PROFILE}`);
    expect(tabHref(PROFILE, "imports")).toBe(`/profiles/${PROFILE}?tab=imports`);
  });
});

describe("removalDescription", () => {
  it("names everything that is deleted with the profile", () => {
    const text = removalDescription("atlas_studio", 2);
    expect(text).toContain("atlas_studio");
    expect(text).toContain("2 stored imports");
    for (const part of ["usernames", "export observations", "count history", "activity", "cannot be undone"]) {
      expect(text, part).toContain(part);
    }
  });

  it("uses the singular for one import and says so when there is none", () => {
    expect(removalDescription("atlas_studio", 1)).toContain("1 stored import ");
    expect(removalDescription("atlas_studio", 0)).toContain("It has no stored imports");
  });
});
