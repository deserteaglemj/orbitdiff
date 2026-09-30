import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminScreen } from "@/components/admin/admin-screen";
import { SessionsTable } from "@/components/settings/sessions-panel";
import { SettingsScreen, type SettingsScreenProps } from "@/components/settings/settings-screen";
import { CONSENT_VERSIONS, LIMITS } from "@/domain/limits";
import type { AdminUserDto, CapacityDto, MeDto, Page } from "@/server/services/contracts";

import { htmlToText } from "../components/support/render";

function render<P extends object>(component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props));
}

/** Every input, select, and textarea tag in the markup. */
function controls(html: string): string[] {
  return html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
}

function control(html: string, name: string): string {
  const found = controls(html).find((tag) => tag.includes(`name="${name}"`));
  if (!found) throw new Error(`no control named ${name}`);
  return found;
}

const names = (html: string) =>
  controls(html)
    .map((tag) => /name="([^"]+)"/.exec(tag)?.[1] ?? "")
    .sort();

/** The markup of the section with this id, up to the next section. Empty when there is no such section. */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  if (start === -1) return "";
  const next = html.indexOf('<section id="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

const headings = (html: string, level: 1 | 2 | 3) =>
  [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "g"))].map((match) => htmlToText(match[1] ?? ""));

/** The visible text of every button. */
const buttons = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((match) => htmlToText(match[1] ?? ""));

const EM_DASH = String.fromCharCode(0x2014);
const AT = "2026-09-30T10:00:00.000Z";
const accepted = (kind: "terms" | "privacy" | "marketing", granted = true) => ({
  granted,
  version: CONSENT_VERSIONS[kind],
  recordedAt: AT,
});

const me: MeDto = {
  id: "user-atlas",
  email: "atlas@orbitdiff.test",
  name: "Atlas Tester",
  timezone: "Europe/Berlin",
  reviewHour: 9,
  onboarded: true,
  isAdmin: false,
  consent: { terms: accepted("terms"), privacy: accepted("privacy"), marketing: accepted("marketing", false) },
  usage: {
    profiles: 2,
    profilesLimit: LIMITS.profilesPerUser,
    importsToday: 1,
    importsPerDayLimit: LIMITS.importsPerUserPerDay,
    rosterBytes: 1536,
    rosterBytesLimit: LIMITS.rosterBytesPerUser,
  },
};

const settingsProps: SettingsScreenProps = {
  me,
  timezones: ["UTC", "America/Chicago", "Europe/Berlin"],
  versions: { ...CONSENT_VERSIONS },
  profiles: [
    { id: "p1", handle: "atlas_studio", status: "active", nextReviewAt: "2026-10-01T07:00:00.000Z" },
    { id: "p2", handle: "nova_labs", status: "paused", nextReviewAt: null },
  ],
};

const settings = (overrides: Partial<SettingsScreenProps> = {}) => render(SettingsScreen, { ...settingsProps, ...overrides });

describe("settings screen", () => {
  const html = settings();
  const text = htmlToText(html);

  it("has one h1 and the six sections in order", () => {
    expect(headings(html, 1)).toEqual(["Settings"]);
    expect(headings(html, 2).slice(0, 6)).toEqual([
      "Profile",
      "Communication",
      "Consent record",
      "Security",
      "Your data",
      "Delete account",
    ]);
  });

  it("says which account it belongs to and that it is not an Instagram account", () => {
    expect(text).toContain("atlas@orbitdiff.test");
    expect(text).toContain("An OrbitDiff account is separate from any Instagram account");
  });

  it("links to each section", () => {
    for (const id of ["profile", "communication", "consent", "security", "data", "delete"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`<section id="${id}"`);
    }
  });

  describe("Profile", () => {
    const part = section(html, "profile");
    const words = htmlToText(part);

    it("asks for the display name, the timezone with a search, and the daily review hour", () => {
      expect(names(part)).toEqual(["name", "reviewHour", "timezone", "timezoneSearch"]);
      for (const label of [
        "Display name (required)",
        "Search timezones",
        "Timezone (required)",
        "Daily review hour (required)",
      ]) {
        expect(words).toContain(label);
      }
    });

    it("shows the stored values", () => {
      expect(control(part, "name")).toContain('value="Atlas Tester"');
      expect(part).toMatch(/<option value="Europe\/Berlin" selected="">/);
      expect(part).toMatch(/<option value="9" selected="">09:00<\/option>/);
    });

    it("offers every timezone it was given", () => {
      for (const zone of settingsProps.timezones) expect(part).toContain(`<option value="${zone}"`);
      expect(words).toContain("Showing 3 of 3 timezones");
    });

    it("keeps the current timezone in the list even when the list lacks it", () => {
      const other = section(settings({ me: { ...me, timezone: "Asia/Tokyo" } }), "profile");
      expect(other).toMatch(/<option value="Asia\/Tokyo" selected="">/);
    });

    it("shows the next review of each profile, and says a paused profile has none", () => {
      expect(words).toContain("atlas_studio");
      expect(words).toContain("1 Oct 2026, 09:00 (Europe/Berlin)");
      expect(words).toContain("nova_labs");
      expect(words).toContain("Paused. No review is scheduled.");
    });

    it("says that a review never contacts Instagram", () => {
      expect(words).toContain("It never contacts Instagram");
    });

    it("says what happens to the schedule when there is no profile", () => {
      const empty = htmlToText(section(settings({ profiles: [] }), "profile"));
      expect(empty).toContain("You have no profiles yet, so no review is scheduled");
    });
  });

  describe("Communication", () => {
    const part = section(html, "communication");
    const words = htmlToText(part);

    it("has one optional box for product news that shows the recorded choice", () => {
      expect(names(part)).toEqual(["marketing"]);
      const box = control(part, "marketing");
      expect(box).toContain('type="checkbox"');
      expect(box).not.toContain("required");
      expect(box).not.toMatch(/\bchecked\b/);
      expect(words).toContain("Send me product news by email");
    });

    it("shows the recorded state, its time, and its version", () => {
      expect(words).toContain(
        `Product news is off. Recorded on 30 Sep 2026, 12:00 (Europe/Berlin), at version ${CONSENT_VERSIONS.marketing}.`,
      );
    });

    it("ticks the box only for a recorded grant", () => {
      const on = section(settings({ me: { ...me, consent: { ...me.consent, marketing: accepted("marketing") } } }), "communication");
      expect(control(on, "marketing")).toMatch(/\bchecked\b/);
      expect(htmlToText(on)).toContain("Product news is on.");
      const none = section(settings({ me: { ...me, consent: { ...me.consent, marketing: null } } }), "communication");
      expect(control(none, "marketing")).not.toMatch(/\bchecked\b/);
      expect(htmlToText(none)).toContain("No choice has been recorded.");
    });

    it("says it is separate from the Terms and the Privacy notice, and names the version it records", () => {
      expect(words).toContain("separate from the Terms and the Privacy notice");
      expect(words).toContain(`version ${CONSENT_VERSIONS.marketing}`);
    });

    it("does not claim that email is sent", () => {
      expect(words).toContain("This preview cannot deliver email yet");
      expect(words).not.toMatch(/we (will )?(send|sent)|check your inbox/i);
    });
  });

  describe("Consent record", () => {
    const part = section(html, "consent");
    const words = htmlToText(part);

    it("shows the version and the time of the recorded terms and privacy consent", () => {
      expect(words).toContain(
        `You accepted version ${CONSENT_VERSIONS.terms} of the Terms on 30 Sep 2026, 12:00 (Europe/Berlin). It is the current version.`,
      );
      expect(words).toContain(
        `You accepted version ${CONSENT_VERSIONS.privacy} of the Privacy notice on 30 Sep 2026, 12:00 (Europe/Berlin). It is the current version.`,
      );
    });

    it("links to both documents", () => {
      expect(part).toContain('href="/legal/terms"');
      expect(part).toContain('href="/legal/privacy"');
    });

    it("is read only: it holds no control and no button", () => {
      expect(controls(part)).toEqual([]);
      expect(buttons(part)).toEqual([]);
      expect(part).not.toContain("<form");
    });

    it("says so when a record is missing", () => {
      const missing = htmlToText(section(settings({ me: { ...me, consent: { ...me.consent, privacy: null } } }), "consent"));
      expect(missing).toContain("No acceptance of the Privacy notice is recorded for this account.");
    });
  });

  describe("Security", () => {
    const part = section(html, "security");
    const words = htmlToText(part);

    it("asks for the current password and the new password twice", () => {
      expect(names(part)).toEqual(["confirmPassword", "currentPassword", "newPassword"]);
      expect(control(part, "currentPassword")).toContain('autoComplete="current-password"');
      expect(control(part, "currentPassword")).toContain("required");
      expect(control(part, "newPassword")).toContain('autoComplete="new-password"');
      expect(control(part, "newPassword")).toContain('minLength="10"');
      for (const name of ["currentPassword", "newPassword", "confirmPassword"]) {
        expect(control(part, name)).toContain('type="password"');
        expect(control(part, name)).not.toMatch(/\svalue="[^"]+"/);
      }
    });

    it("says that changing the password signs the other devices out", () => {
      expect(words).toContain("Changing your password signs you out on every other device");
    });

    it("offers sign out, and sign out of all other devices", () => {
      expect(buttons(part)).toEqual(expect.arrayContaining(["Sign out", "Sign out of all other devices"]));
    });

    it("shows the list of devices as loading until the browser has asked for it", () => {
      expect(words).toContain("Loading the signed-in devices");
      expect(part).toContain('role="status"');
    });

    it("says these are OrbitDiff logins, not Instagram logins", () => {
      expect(words).toContain("your OrbitDiff password");
    });
  });

  describe("Your data", () => {
    const part = section(html, "data");
    const words = htmlToText(part);

    it("offers the download as a plain link to the export route", () => {
      expect(part).toMatch(/<a\b[^>]*href="\/api\/account\/export"[^>]*download/);
      expect(words).toContain("Download my data (JSON)");
    });

    it("says what the file contains, in plain words", () => {
      for (const phrase of [
        "your account details",
        "your consent records",
        "your profiles",
        "every export you imported",
        "activity",
        "one JSON file",
      ]) {
        expect(words).toContain(phrase);
      }
      expect(words).toContain("It does not contain your password");
    });

    it("says the file holds other people's usernames from the exports", () => {
      expect(words).toContain("other people's Instagram usernames");
      expect(words).toContain("Keep it somewhere private");
    });

    it("shows the usage against each quota, in words", () => {
      expect(words).toContain("2 of 3");
      expect(words).toContain("1 of 10");
      expect(words).toContain("1.5 KB of 20 MB");
      expect(words).toContain("Within the limit");
    });

    it("shows a reached quota as a visible paused state with the reason", () => {
      const full = htmlToText(
        section(
          settings({
            me: {
              ...me,
              usage: { ...me.usage, profiles: 3, importsToday: 10, rosterBytes: LIMITS.rosterBytesPerUser },
            },
          }),
          "data",
        ),
      );
      expect(full).toContain("Limit reached");
      expect(full).toContain("You cannot add another profile until you remove one.");
      expect(full).toContain("Imports are paused until the next UTC day.");
      expect(full).toContain("Imports are paused until you remove a profile to make room.");
    });
  });

  describe("Delete account", () => {
    const part = section(html, "delete");
    const words = htmlToText(part);

    it("says exactly what is deleted", () => {
      for (const phrase of [
        "your email address, display name, and password",
        "your sign-in sessions on every device",
        "your consent records",
        "every profile",
        "every export you imported, with the usernames in it",
        "the differences calculated from your exports",
        "your activity, background jobs, and usage counters",
        "account messages stored for your address",
      ]) {
        expect(words).toContain(phrase);
      }
    });

    it("says that it cannot be undone", () => {
      expect(words).toContain("This cannot be undone");
      expect(words).toContain("Problem:");
    });

    it("says what stays, without a name attached", () => {
      expect(words).toContain("A record that an account was deleted stays in the security log. It holds nothing that identifies you.");
    });

    it("points to the download first", () => {
      expect(part).toContain('href="#data"');
    });

    it("keeps links out of the danger notice, where the link colour has too little contrast on the fill", () => {
      const start = part.indexOf("bg-danger-tint");
      expect(start).toBeGreaterThan(-1);
      const notice = part.slice(start, part.indexOf("</div></div>", start));
      expect(notice).toContain("This cannot be undone");
      expect(notice).not.toContain("od-link");
      expect(notice).not.toContain("<a ");
      expect(notice).not.toContain("<button");
    });

    it("requires the current password, empty to begin with, and never an Instagram one", () => {
      expect(names(part)).toEqual(["deletePassword"]);
      const field = control(part, "deletePassword");
      expect(field).toContain('type="password"');
      expect(field).toContain('autoComplete="current-password"');
      expect(field).toContain("required");
      expect(field).not.toMatch(/\svalue="[^"]+"/);
      expect(words).toContain("Your OrbitDiff password (required)");
    });

    it("has one submit button, and the final confirmation names the action", () => {
      expect((part.match(/<button\b[^>]*type="submit"/g) ?? []).length).toBe(1);
      expect(buttons(part)).toEqual(expect.arrayContaining(["Delete my account", "Delete permanently", "Keep my account"]));
    });
  });

  it("asks for nothing about an Instagram login in any field", () => {
    for (const tag of controls(html)) expect(tag).not.toMatch(/instagram/i);
    const labels = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((match) => htmlToText(match[1] ?? ""));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).not.toMatch(/instagram|verification code|cookie|session/i);
  });

  it("gives every control a name and a label", () => {
    for (const tag of controls(html)) {
      expect(tag).toMatch(/\sname="[^"]+"/);
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      expect(id, tag).toBeTruthy();
      expect(html).toContain(`for="${id}"`);
    }
  });

  it("gives every form its own validation and exactly one submit button", () => {
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    expect(forms).toHaveLength(4);
    for (const form of forms) {
      expect(form).toContain("noValidate");
      expect((form.match(/<button\b[^>]*type="submit"/g) ?? []).length).toBe(1);
    }
  });

  it("renders no inline style attribute, which the content security policy would block", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toContain("<script");
  });

  it("contains no U+2014 character", () => {
    expect(html).not.toContain(EM_DASH);
  });

  it("never claims that tracking is automatic or happens as things change", () => {
    expect(text).not.toMatch(/tracks? (your )?followers|in real time|as changes happen|monitors? your/i);
  });
});

describe("the table of signed-in devices", () => {
  const rows = [
    {
      key: "s-current",
      token: "tok-current-device",
      current: true,
      device: "Chrome on macOS",
      address: "203.0.113.7",
      signedInAt: "2026-09-30T08:00:00.000Z",
      expiresAt: "2026-10-07T08:00:00.000Z",
    },
    {
      key: "s-other",
      token: "tok-other-device",
      current: false,
      device: "Firefox on Linux",
      address: "Unknown",
      signedInAt: "2026-09-29T08:00:00.000Z",
      expiresAt: null,
    },
  ];
  const html = render(SessionsTable, { rows, timeZone: "Europe/Berlin", busyKey: null, onRevoke: () => undefined });
  const text = htmlToText(html);

  it("shows the device, the network address, and the times of each login", () => {
    for (const phrase of [
      "Chrome on macOS",
      "203.0.113.7",
      "30 Sep 2026, 10:00 (Europe/Berlin)",
      "7 Oct 2026, 10:00 (Europe/Berlin)",
      "Firefox on Linux",
      "Unknown",
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it("marks this device in words and offers to sign out only the other one", () => {
    expect(text).toContain("This device");
    expect(buttons(html)).toEqual(["Sign out this device"]);
    // The accessible name starts with the visible label, then says which device.
    expect(html).toContain(
      'aria-label="Sign out this device: Firefox on Linux, signed in 29 Sep 2026, 10:00 (Europe/Berlin)"',
    );
  });

  it("never renders a session token", () => {
    expect(html).not.toContain("tok-current-device");
    expect(html).not.toContain("tok-other-device");
  });

  it("names the table", () => {
    expect(html).toContain("<caption");
    expect(text).toContain("Devices signed in to your OrbitDiff account");
  });
});

const NOW = "2026-09-30T12:00:00.000Z";
const MB = 1024 * 1024;

const capacity: CapacityDto = {
  users: { used: 2, limit: 250, paused: false },
  jobsToday: { used: 150, limit: 2000, paused: false },
  database: { bytes: 120 * MB, limit: 400 * MB, paused: false, measuredAt: "2026-09-30T11:30:00.000Z" },
  lastTick: {
    at: "2026-09-30T11:30:00.000Z",
    recovered: 0,
    enqueued: 4,
    claimed: 5,
    succeeded: 5,
    failed: 0,
    retried: 0,
    cancelled: 0,
    remaining: 0,
    cleaned: 7,
    durationMs: 1840,
    pausedForCapacity: false,
  },
  mail: { available: true, mode: "captured" },
  registration: { open: true, reason: null },
};

const atlas: AdminUserDto = {
  id: "user-atlas",
  email: "atlas@orbitdiff.test",
  name: "Atlas Tester",
  createdAt: "2026-09-29T08:15:00.000Z",
  emailVerified: true,
  status: "active",
  onboarded: true,
  consent: { terms: accepted("terms"), privacy: accepted("privacy"), marketing: accepted("marketing", false) },
  usage: {
    profiles: 2,
    snapshots: 5,
    rosterBytes: 1536,
    importsLast30Days: 3,
    jobsLast30Days: 12,
    lastActivityAt: "2026-09-30T11:45:00.000Z",
  },
};

const nova: AdminUserDto = {
  ...atlas,
  id: "user-nova",
  email: "nova@orbitdiff.test",
  name: "Nova Tester",
  emailVerified: false,
  status: "suspended",
  onboarded: false,
  consent: { terms: null, privacy: null, marketing: null },
  usage: { profiles: 0, snapshots: 0, rosterBytes: 0, importsLast30Days: 0, jobsLast30Days: 0, lastActivityAt: null },
};

const page = (data: AdminUserDto[]): Page<AdminUserDto> => ({
  data,
  pagination: { page: 1, pageSize: 25, totalItems: data.length, totalPages: data.length === 0 ? 0 : 1 },
});

const admin = (overrides: { capacity?: CapacityDto; users?: Page<AdminUserDto> } = {}) =>
  render(AdminScreen, { capacity, users: page([atlas, nova]), now: NOW, ...overrides });

describe("admin screen", () => {
  const html = admin();
  const text = htmlToText(html);

  it("has one h1 and the two sections", () => {
    expect(headings(html, 1)).toEqual(["Admin"]);
    expect(headings(html, 2)).toEqual(["Capacity", "Accounts"]);
  });

  it("says it is read only and that times are UTC", () => {
    expect(text).toContain("Read only");
    expect(text).toContain("Times are in UTC");
  });

  describe("capacity", () => {
    it("shows each reading against its cap, in words", () => {
      for (const phrase of [
        "2 of 250 accounts",
        "150 of 2,000 jobs",
        "120 MB of 400 MB",
        "Captured",
        "Stored, not sent",
        "Open",
        "30 Sep 2026, 11:30 (UTC)",
        "On schedule",
        "Daily reviews queued",
        "1,840 ms",
      ]) {
        expect(text).toContain(phrase);
      }
    });

    it("shows no paused notice when nothing is paused", () => {
      expect(text).not.toContain("paused right now");
    });

    it("shows a visible paused state, with the reason, for everything that is paused", () => {
      const paused = htmlToText(
        admin({
          capacity: {
            ...capacity,
            users: { used: 250, limit: 250, paused: true },
            jobsToday: { used: 2000, limit: 2000, paused: true },
            database: { bytes: 400 * MB, limit: 400 * MB, paused: true, measuredAt: NOW },
            mail: { available: false, mode: "none" },
            registration: { open: false, reason: "Registration is paused: capacity reached." },
            lastTick: { ...capacity.lastTick!, pausedForCapacity: true },
          },
        }),
      );
      for (const phrase of [
        "6 things are paused right now",
        "Registration is paused: the account cap is reached.",
        "Scheduled reviews are paused: the daily job cap is reached.",
        "Imports are paused: the measured database size has reached the cap.",
        "No account message can be stored or sent",
        "Registration is paused: capacity reached.",
        "Paused for capacity",
      ]) {
        expect(paused).toContain(phrase);
      }
    });

    it("says Unknown, never zero, for a database size that was not measured", () => {
      const unmeasured = htmlToText(
        admin({ capacity: { ...capacity, database: { bytes: null, limit: 400 * MB, paused: false, measuredAt: null } } }),
      );
      expect(unmeasured).toContain("Unknown of 400 MB");
      expect(unmeasured).toContain("Not measured");
    });

    it("says so when no batch run is recorded", () => {
      expect(htmlToText(admin({ capacity: { ...capacity, lastTick: null } }))).toContain("None recorded");
    });
  });

  describe("accounts", () => {
    it("names the table and says how many accounts it shows", () => {
      expect(html).toContain("<caption");
      expect(text).toContain("Showing 1 to 2 of 2 accounts.");
    });

    it("shows every column of an account", () => {
      for (const phrase of [
        "atlas@orbitdiff.test",
        "Atlas Tester",
        "29 Sep 2026, 08:15 (UTC)",
        "Verified",
        "Active",
        "Onboarded",
        `Version ${CONSENT_VERSIONS.terms}, accepted 30 Sep 2026, 10:00 (UTC)`,
        "Off since 30 Sep 2026, 10:00 (UTC)",
        "1.5 KB",
        "30 Sep 2026, 11:45 (UTC)",
      ]) {
        expect(text).toContain(phrase);
      }
    });

    it("says in words when an account is not verified, suspended, not onboarded, or has no consent record", () => {
      for (const phrase of ["Not verified", "Suspended", "Not onboarded", "Not recorded", "None yet"]) {
        expect(text).toContain(phrase);
      }
    });

    it("labels every cell, so a row still reads on a phone", () => {
      const labels = new Set([...html.matchAll(/data-label="([^"]+)"/g)].map((match) => match[1]));
      expect([...labels].sort()).toEqual(
        ["Account", "Activity", "Consent", "Sign-up and state", "Stored"].sort(),
      );
    });

    it("has a labelled search by email or name", () => {
      expect(names(html)).toEqual(["q"]);
      expect(control(html, "q")).toContain('type="search"');
      expect(text).toContain("Search by email or name");
      const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
      expect(forms).toHaveLength(1);
      expect((forms[0]!.match(/<button\b[^>]*type="submit"/g) ?? []).length).toBe(1);
    });

    it("is read only: the only buttons search and page through the list", () => {
      expect(buttons(html)).toEqual(["Search"]);
      const many = admin({
        users: { data: [atlas, nova], pagination: { page: 2, pageSize: 2, totalItems: 6, totalPages: 3 } },
      });
      for (const label of buttons(many)) {
        expect(["Search", "Previous", "Next", "1", "2", "3"]).toContain(label);
      }
      expect(htmlToText(many)).toContain("Showing 3 to 4 of 6 accounts.");
    });

    it("says why the list is empty", () => {
      const empty = htmlToText(admin({ users: page([]) }));
      expect(empty).toContain("There are no accounts.");
    });
  });

  it("shows no password, token, roster, or Instagram username", () => {
    expect(text).not.toMatch(/password|token|atlas_studio|nova_labs|pixel_forge/i);
    expect(html).not.toMatch(/type="password"/);
  });

  it("gives every control a name and a label", () => {
    for (const tag of controls(html)) {
      expect(tag).toMatch(/\sname="[^"]+"/);
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      expect(id, tag).toBeTruthy();
      expect(html).toContain(`for="${id}"`);
    }
  });

  it("renders no inline style attribute and no U+2014 character", () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain(EM_DASH);
  });
});
