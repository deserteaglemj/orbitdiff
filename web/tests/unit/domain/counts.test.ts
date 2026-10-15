import { describe, expect, it } from "vitest";

import { countHistory, describeNetChange } from "@/domain/counts";
import { DomainError } from "@/domain/errors";
import type { Snapshot } from "@/domain/export/snapshot";

type Counted = Snapshot & { snapshotDigest: string };

function snapshot(
  id: string,
  capturedAt: string | null,
  followers: string[] | null,
  following: string[] | null,
  declared: { followers?: boolean; following?: boolean } = { followers: true, following: true },
  followersShards?: number[],
): Counted {
  return {
    snapshotDigest: id,
    capturedAt,
    followers,
    following,
    shards: {
      followers: followersShards ?? (followers === null ? [] : [1]),
      following: following === null ? [] : [0],
    },
    declarations: { followers: declared.followers ?? false, following: declared.following ?? false },
  };
}

const names = (count: number, prefix: string): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}_${String(index).padStart(3, "0")}`);

describe("describeNetChange", () => {
  it("words a change from 100 to 103 as net growth of 3", () => {
    expect(describeNetChange(100, 103)).toBe("Net growth of 3");
  });

  it("words a decline and no change", () => {
    expect(describeNetChange(103, 100)).toBe("Net decline of 3");
    expect(describeNetChange(100, 100)).toBe("No net change");
    expect(describeNetChange(0, 0)).toBe("No net change");
    expect(describeNetChange(0, 1)).toBe("Net growth of 1");
    expect(describeNetChange(1200, 2500)).toBe("Net growth of 1300");
  });

  it("rejects values that are not counts", () => {
    for (const [previous, next] of [
      [-1, 3],
      [3, -1],
      [1.5, 3],
      [3, Number.NaN],
      [3, Number.POSITIVE_INFINITY],
    ]) {
      expect(() => describeNetChange(previous, next)).toThrow(DomainError);
    }
  });
});

describe("countHistory", () => {
  const first = snapshot("aa", "2026-09-01T12:00:00+00:00", names(100, "nova_labs"), names(40, "pixel_forge"));
  const second = snapshot("bb", "2026-09-10T12:00:00+00:00", names(103, "lunar_arch"), names(38, "ember_lab"));

  it("lists dated snapshots in capture order with counts for complete directions", () => {
    expect(countHistory([second, first])).toEqual({
      points: [
        { snapshotDigest: "aa", capturedAt: "2026-09-01T12:00:00+00:00", followers: 100, following: 40 },
        { snapshotDigest: "bb", capturedAt: "2026-09-10T12:00:00+00:00", followers: 103, following: 38 },
      ],
      followersChange: "Net growth of 3",
      followingChange: "Net decline of 2",
    });
  });

  it("never names accounts, even when every account changed", () => {
    const result = countHistory([first, second]);
    const text = JSON.stringify(result);
    for (const username of [...(first.followers ?? []), ...(second.followers ?? []), ...(second.following ?? [])]) {
      expect(text).not.toContain(username);
    }
    expect(text).not.toMatch(/nova_labs|pixel_forge|lunar_arch|ember_lab/);
    for (const point of result.points) {
      expect(Object.keys(point).sort()).toEqual(["capturedAt", "followers", "following", "snapshotDigest"]);
    }
  });

  it("reports no net change when the count is equal and the accounts differ", () => {
    const later = snapshot("cc", "2026-09-20T12:00:00+00:00", names(103, "sunset_field"), names(38, "atlas_studio"));
    const result = countHistory([second, later]);
    expect(result.followersChange).toBe("No net change");
    expect(result.followingChange).toBe("No net change");
  });

  it("leaves a direction unknown unless its coverage is complete", () => {
    const partial = snapshot("dd", "2026-09-15T12:00:00+00:00", names(7, "nova_labs"), names(5, "pixel_forge"), {
      followers: false,
      following: true,
    });
    const gapped = snapshot(
      "ee",
      "2026-09-16T12:00:00+00:00",
      names(9, "nova_labs"),
      names(6, "pixel_forge"),
      { followers: true, following: true },
      [1, 3],
    );
    const onlyFollowing = snapshot("ff", "2026-09-17T12:00:00+00:00", null, names(8, "pixel_forge"));
    expect(countHistory([partial, gapped, onlyFollowing]).points).toEqual([
      { snapshotDigest: "dd", capturedAt: "2026-09-15T12:00:00+00:00", followers: null, following: 5 },
      { snapshotDigest: "ee", capturedAt: "2026-09-16T12:00:00+00:00", followers: null, following: 6 },
      { snapshotDigest: "ff", capturedAt: "2026-09-17T12:00:00+00:00", followers: null, following: 8 },
    ]);
  });

  it("compares the two most recent known counts of each direction", () => {
    const middle = snapshot("gg", "2026-09-05T12:00:00+00:00", names(500, "nova_labs"), names(39, "pixel_forge"), {
      followers: false,
      following: true,
    });
    const result = countHistory([first, middle, second]);
    expect(result.followersChange).toBe("Net growth of 3");
    expect(result.followingChange).toBe("Net decline of 1");
  });

  it("ignores undated snapshots and snapshots without a complete direction", () => {
    const undated = snapshot("hh", null, names(900, "nova_labs"), names(900, "pixel_forge"));
    const undeclared = snapshot("ii", "2026-09-12T12:00:00+00:00", names(3, "nova_labs"), names(3, "pixel_forge"), {});
    expect(countHistory([undated, undeclared])).toEqual({ points: [], followersChange: null, followingChange: null });
    expect(countHistory([undated, first]).points).toHaveLength(1);
  });

  it("needs two known counts before it words a change", () => {
    expect(countHistory([first])).toMatchObject({ followersChange: null, followingChange: null });
    expect(countHistory([])).toEqual({ points: [], followersChange: null, followingChange: null });
  });

  it("counts a present empty list as zero", () => {
    const empty = snapshot("jj", "2026-09-25T12:00:00+00:00", [], names(2, "pixel_forge"));
    const result = countHistory([second, empty]);
    expect(result.points[1].followers).toBe(0);
    expect(result.followersChange).toBe("Net decline of 103");
  });
});
