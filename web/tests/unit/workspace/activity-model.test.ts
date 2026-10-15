import { describe, expect, it } from "vitest";

import {
  ACTIVITY_KIND_OPTIONS,
  ACTIVITY_STATUS_OPTIONS,
  activityHref,
  activityRow,
  readActivityQuery,
} from "@/components/dashboard/activity-model";
import type { ActivityDto } from "@/server/services/contracts";

const OWN = "3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b";
const FOREIGN = "9d1f6a52-0c3b-4f7e-8a21-5b6c7d8e9f01";

function entry(overrides: Partial<ActivityDto> = {}): ActivityDto {
  return {
    id: "a1",
    profileId: OWN,
    profileHandle: "atlas_studio",
    kind: "import_processed",
    status: "ok",
    occurredAt: "2026-09-29T18:00:05.000Z",
    title: "Baseline stored",
    detail: "A baseline was stored. Nothing can be compared yet: differences appear after a second dated import.",
    ...overrides,
  };
}

describe("activityRow", () => {
  it("keeps the wording of the service and adds the time in the user's timezone", () => {
    expect(activityRow(entry(), "America/Chicago")).toEqual({
      id: "a1",
      title: "Baseline stored",
      detail: "A baseline was stored. Nothing can be compared yet: differences appear after a second dated import.",
      when: "29 Sep 2026, 13:00 (America/Chicago)",
      kind: "Import processed",
      badge: { tone: "ok", text: "Done" },
      handle: "atlas_studio",
      profileHref: `/profiles/${OWN}`,
    });
  });

  it("marks a failure as its own entry, in words", () => {
    const row = activityRow(
      entry({
        kind: "job_failed",
        status: "failed",
        title: "Processing failed",
        detail: "Processing failed. The last successful result is unchanged; it is from 29 Sep 2026.",
      }),
      "UTC",
    );
    expect(row.badge).toEqual({ tone: "danger", text: "Failed" });
    expect(row.kind).toBe("Failure");
    expect(row.detail).toContain("last successful result is unchanged");
  });

  it("labels an informational entry and an entry without a profile", () => {
    const row = activityRow(
      entry({ kind: "profile_added", status: "info", profileId: null, profileHandle: null, detail: null }),
      "UTC",
    );
    expect(row.badge).toEqual({ tone: "neutral", text: "Recorded" });
    expect(row.kind).toBe("Profile added");
    expect(row.handle).toBeNull();
    expect(row.profileHref).toBeNull();
    expect(row.detail).toBe("");
  });
});

describe("filter options", () => {
  it("offers every kind and every status with a label, after an option for all", () => {
    expect(ACTIVITY_KIND_OPTIONS.map((option) => option.value)).toEqual([
      "",
      "import_received",
      "import_processed",
      "review",
      "job_failed",
      "profile_added",
      "profile_paused",
      "profile_resumed",
    ]);
    expect(ACTIVITY_KIND_OPTIONS[0].label).toBe("All kinds");
    expect(ACTIVITY_STATUS_OPTIONS).toEqual([
      { value: "", label: "All statuses" },
      { value: "ok", label: "Done" },
      { value: "failed", label: "Failed" },
      { value: "info", label: "Recorded" },
    ]);
  });
});

describe("readActivityQuery", () => {
  it("reads the filters and the page from the address", () => {
    expect(
      readActivityQuery({ profile: OWN, kind: "review", status: "ok", q: " atlas ", page: "2" }, [OWN]),
    ).toEqual({ profileId: OWN, kind: "review", status: "ok", q: "atlas", page: 2 });
  });

  it("ignores a profile that is not one of the user's own, so another tenant's id filters nothing in", () => {
    expect(readActivityQuery({ profile: FOREIGN }, [OWN]).profileId).toBeNull();
    expect(readActivityQuery({ profile: "not-an-id" }, [OWN]).profileId).toBeNull();
  });

  it("ignores unknown kinds and statuses instead of failing the page", () => {
    expect(readActivityQuery({ kind: "everything", status: "great" }, [OWN])).toEqual({
      profileId: null,
      kind: null,
      status: null,
      q: "",
      page: 1,
    });
  });
});

describe("activityHref", () => {
  it("keeps the filters when the page changes and points at the feed", () => {
    const query = { profileId: OWN, kind: "review" as const, status: null, q: "atlas", page: 1 };
    expect(activityHref("/dashboard", query, 3)).toBe(
      `/dashboard?q=atlas&profile=${OWN}&kind=review&page=3#activity`,
    );
    expect(activityHref("/dashboard", { profileId: null, kind: null, status: null, q: "", page: 4 }, 1)).toBe(
      "/dashboard#activity",
    );
  });

  it("points at another anchor when the host page names one", () => {
    const query = { profileId: null, kind: null, status: null, q: "", page: 1 };
    expect(activityHref(`/profiles/${OWN}`, query, 2, { tab: "activity" }, "section")).toBe(
      `/profiles/${OWN}?tab=activity&page=2#section`,
    );
  });

  it("carries fixed parameters of the page it lives on", () => {
    const query = { profileId: null, kind: null, status: "failed" as const, q: "", page: 1 };
    expect(activityHref(`/profiles/${OWN}`, query, 2, { tab: "activity" })).toBe(
      `/profiles/${OWN}?tab=activity&status=failed&page=2#activity`,
    );
  });
});
