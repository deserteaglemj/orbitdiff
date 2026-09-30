import { describe, expect, it } from "vitest";

import {
  adminUserRow,
  adminUsersPath,
  describeResultCount,
  loadUsers,
  readUsersPage,
  validateSearch,
} from "@/components/admin/users";
import type { AdminUserDto } from "@/server/services/contracts";

const AT = "2026-09-30T10:00:00.000Z";
const record = (granted: boolean) => ({ granted, version: "2026-09-30", recordedAt: AT });

const atlas: AdminUserDto = {
  id: "user-atlas",
  email: "atlas@orbitdiff.test",
  name: "Atlas Tester",
  createdAt: "2026-09-29T08:15:00.000Z",
  emailVerified: true,
  status: "active",
  onboarded: true,
  consent: { terms: record(true), privacy: record(true), marketing: record(false) },
  usage: {
    profiles: 2,
    snapshots: 5,
    rosterBytes: 1536,
    importsLast30Days: 3,
    jobsLast30Days: 1200,
    lastActivityAt: "2026-09-30T11:45:00.000Z",
  },
};

describe("adminUserRow", () => {
  it("words every column of one account", () => {
    expect(adminUserRow(atlas)).toEqual({
      id: "user-atlas",
      email: "atlas@orbitdiff.test",
      name: "Atlas Tester",
      signedUp: "29 Sep 2026, 08:15 (UTC)",
      verified: { label: "Verified", tone: "ok" },
      status: { label: "Active", tone: "ok" },
      onboarding: { label: "Onboarded", tone: "ok" },
      terms: "Version 2026-09-30, accepted 30 Sep 2026, 10:00 (UTC)",
      privacy: "Version 2026-09-30, accepted 30 Sep 2026, 10:00 (UTC)",
      marketing: "Off since 30 Sep 2026, 10:00 (UTC)",
      profiles: "2",
      snapshots: "5",
      storedBytes: "1.5 KB",
      imports: "3",
      jobs: "1,200",
      lastActivity: "30 Sep 2026, 11:45 (UTC)",
    });
  });

  it("says so in words when the address is not verified, the account is suspended, or onboarding is open", () => {
    const row = adminUserRow({ ...atlas, emailVerified: false, status: "suspended", onboarded: false });
    expect(row.verified).toEqual({ label: "Not verified", tone: "warning" });
    expect(row.status).toEqual({ label: "Suspended", tone: "warning" });
    expect(row.onboarding).toEqual({ label: "Not onboarded", tone: "neutral" });
  });

  it("treats anything but the exact values as not verified, not active, and not onboarded", () => {
    const odd = { ...atlas, emailVerified: "true", status: "paused", onboarded: 1 } as unknown as AdminUserDto;
    const row = adminUserRow(odd);
    expect([row.verified.label, row.status.label, row.onboarding.label]).toEqual([
      "Not verified",
      "Suspended",
      "Not onboarded",
    ]);
  });

  it("says Not recorded for consent that has no record", () => {
    const row = adminUserRow({ ...atlas, consent: { terms: null, privacy: null, marketing: null } });
    expect([row.terms, row.privacy, row.marketing]).toEqual(["Not recorded", "Not recorded", "Not recorded"]);
  });

  it("says withdrawn for a document record that is not granted", () => {
    const row = adminUserRow({ ...atlas, consent: { ...atlas.consent, terms: record(false) } });
    expect(row.terms).toBe("Version 2026-09-30, withdrawn 30 Sep 2026, 10:00 (UTC)");
  });

  it("says on, with the version, for granted marketing consent", () => {
    const row = adminUserRow({ ...atlas, consent: { ...atlas.consent, marketing: record(true) } });
    expect(row.marketing).toBe("On since 30 Sep 2026, 10:00 (UTC), version 2026-09-30");
  });

  it("says there is no activity yet, not a date, when none is recorded", () => {
    const row = adminUserRow({ ...atlas, usage: { ...atlas.usage, lastActivityAt: null } });
    expect(row.lastActivity).toBe("None yet");
  });

  it("has no column that could hold a password, a token, a roster, or an Instagram username", () => {
    expect(Object.keys(adminUserRow(atlas)).sort()).toEqual(
      [
        "email",
        "id",
        "imports",
        "jobs",
        "lastActivity",
        "marketing",
        "name",
        "onboarding",
        "privacy",
        "profiles",
        "signedUp",
        "snapshots",
        "status",
        "storedBytes",
        "terms",
        "verified",
      ].sort(),
    );
  });

  it("carries nothing over from extra fields an answer might hold", () => {
    const leaky = { ...atlas, password: "hunter2-hunter2", token: "tok-123", handles: ["atlas_studio"] } as AdminUserDto;
    const text = JSON.stringify(adminUserRow(leaky));
    for (const secret of ["hunter2", "tok-123", "atlas_studio"]) expect(text).not.toContain(secret);
  });
});

describe("adminUsersPath", () => {
  it("asks for the first page with no search", () => {
    expect(adminUsersPath({ q: "", page: 1 })).toBe("/api/admin/users?page=1");
  });

  it("adds the trimmed search text, encoded", () => {
    expect(adminUsersPath({ q: "  atlas+nova@orbitdiff.test ", page: 2 })).toBe(
      "/api/admin/users?page=2&q=atlas%2Bnova%40orbitdiff.test",
    );
    expect(adminUsersPath({ q: "a&page=9", page: 1 })).toBe("/api/admin/users?page=1&q=a%26page%3D9");
  });

  it.each([0, -3, 1.5, Number.NaN])("asks for the first page when the page is %s", (page) => {
    expect(adminUsersPath({ q: "", page })).toBe("/api/admin/users?page=1");
  });
});

describe("validateSearch", () => {
  it("accepts an empty search and a search of up to 100 characters", () => {
    expect(validateSearch("")).toBeUndefined();
    expect(validateSearch("a".repeat(100))).toBeUndefined();
  });

  it("refuses a longer search, as the server does", () => {
    expect(validateSearch("a".repeat(101))).toBe("Use at most 100 characters.");
  });
});

describe("readUsersPage", () => {
  const pagination = { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 };

  it("returns the page of an answer in the list shape", () => {
    expect(readUsersPage({ data: [atlas], pagination })).toEqual({ data: [atlas], pagination });
  });

  it.each([
    ["null", null],
    ["a list", [atlas]],
    ["an answer without data", { pagination }],
    ["an answer whose data is not a list", { data: atlas, pagination }],
    ["an answer without pagination", { data: [atlas] }],
    ["an answer whose page is not a number", { data: [atlas], pagination: { ...pagination, page: "1" } }],
    ["an answer with an entry that is not an account", { data: ["atlas"], pagination }],
    ["an answer with an entry without an email", { data: [{ ...atlas, email: undefined }], pagination }],
  ])("returns null for %s", (_label, answer) => {
    expect(readUsersPage(answer)).toBeNull();
  });
});

describe("loadUsers", () => {
  const pagination = { page: 2, pageSize: 25, totalItems: 30, totalPages: 2 };
  const failure = (status: number, code: string, message: string, fields: string[] = []) => ({
    ok: false as const,
    status,
    code,
    message,
    fields,
  });

  it("asks the accounts route for the page and the search, and returns the page it answered", async () => {
    const asked: string[] = [];
    const result = await loadUsers(
      async (path) => {
        asked.push(path);
        return { ok: true, data: { data: [atlas], pagination } };
      },
      { q: " atlas ", page: 2 },
    );
    expect(asked).toEqual(["/api/admin/users?page=2&q=atlas"]);
    expect(result).toEqual({ ok: true, page: { data: [atlas], pagination } });
  });

  it("puts a refusal about the search text on the search field", async () => {
    const refused = failure(422, "invalid_input", "q must be at most 100 characters.", ["q"]);
    expect(await loadUsers(async () => refused, { q: "x", page: 1 })).toEqual({
      ok: false,
      field: "q",
      message: "q must be at most 100 characters.",
    });
  });

  it("shows any other refusal with the route's own message", async () => {
    const refused = failure(404, "not_found", "Not found.");
    expect(await loadUsers(async () => refused, { q: "", page: 1 })).toEqual({
      ok: false,
      field: null,
      message: "Not found.",
    });
  });

  it("does not show an answer it cannot read as a list of accounts", async () => {
    const result = await loadUsers(async () => ({ ok: true, data: { data: "accounts" } }), { q: "", page: 1 });
    expect(result).toEqual({
      ok: false,
      field: null,
      message: "The server answered in a form this page cannot read. Reload the page.",
    });
  });
});

describe("describeResultCount", () => {
  it("says which accounts of how many are shown", () => {
    expect(describeResultCount({ page: 1, pageSize: 25, totalItems: 60, totalPages: 3 }, "")).toBe(
      "Showing 1 to 25 of 60 accounts.",
    );
    expect(describeResultCount({ page: 3, pageSize: 25, totalItems: 60, totalPages: 3 }, "")).toBe(
      "Showing 51 to 60 of 60 accounts.",
    );
  });

  it("uses the singular for one account", () => {
    expect(describeResultCount({ page: 1, pageSize: 25, totalItems: 1, totalPages: 1 }, "")).toBe("Showing 1 account.");
    expect(describeResultCount({ page: 1, pageSize: 25, totalItems: 1, totalPages: 1 }, "nova")).toBe(
      'Showing 1 account that matches "nova".',
    );
  });

  it("names the search", () => {
    expect(describeResultCount({ page: 1, pageSize: 25, totalItems: 2, totalPages: 1 }, " atlas ")).toBe(
      'Showing 1 to 2 of 2 accounts that match "atlas".',
    );
  });

  it("says when nothing matches and when there are no accounts", () => {
    expect(describeResultCount({ page: 1, pageSize: 25, totalItems: 0, totalPages: 0 }, "zzz")).toBe(
      'No account matches "zzz".',
    );
    expect(describeResultCount({ page: 1, pageSize: 25, totalItems: 0, totalPages: 0 }, "")).toBe("There are no accounts.");
  });
});
