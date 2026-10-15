import { expect, vi } from "vitest";

import { GET as exportGET } from "@/app/api/account/export/route";
import { GET as activityGET } from "@/app/api/activity/route";
import { GET as capacityGET } from "@/app/api/admin/capacity/route";
import { GET as usersGET } from "@/app/api/admin/users/route";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as tickPOST } from "@/app/api/jobs/tick/route";
import { POST as onboardingPOST } from "@/app/api/me/onboarding/route";
import { GET as meGET, PATCH as mePATCH } from "@/app/api/me/route";
import { GET as countsGET } from "@/app/api/profiles/[id]/counts/route";
import { GET as eventsGET } from "@/app/api/profiles/[id]/events/route";
import { POST as importPOST } from "@/app/api/profiles/[id]/imports/route";
import { GET as relationshipsGET } from "@/app/api/profiles/[id]/relationships/route";
import { POST as reviewPOST } from "@/app/api/profiles/[id]/review/route";
import { DELETE as profileDELETE, GET as profileGET, PATCH as profilePATCH } from "@/app/api/profiles/[id]/route";
import { GET as snapshotsGET } from "@/app/api/profiles/[id]/snapshots/route";
import { GET as profilesGET, POST as profilesPOST } from "@/app/api/profiles/route";
import { GET as mailboxGET } from "@/app/api/staging/mailbox/route";
import { CONSENT_VERSIONS } from "@/domain/limits";
import { settleBackground } from "@/server/http/background";
import type {
  ActivityDto,
  ExportEventDto,
  ImportReceiptDto,
  MeDto,
  Page,
  ProfileDto,
  TickSummaryDto,
} from "@/server/services/contracts";

import { authRequest, callRoute, extractLink, type RouteCall, signUp, TEST_PASSWORD } from "../../helpers";

/**
 * Support for the journey tests. A journey drives the app only through what a
 * customer, the operator's mailbox, and the scheduler can reach: the Better
 * Auth handler, the route handlers, the captured mail endpoint, and the batch
 * endpoint with its secret. Nothing here writes to or reads from a table. The
 * one look inside the process is watchBackground, which tells whether a
 * response was ready before the work it started had finished.
 */

export const ATLAS = "atlas@orbitdiff.test";
export const NOVA = "nova@orbitdiff.test";
export const OWNER = "owner@orbitdiff.test";

/** A well-formed id that belongs to nothing. */
export const RANDOM_ID = "3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b";

export const FIRST_CAPTURE = "2026-09-01T12:00:00+00:00";
export const SECOND_CAPTURE = "2026-09-10T12:00:00+00:00";

export type ExportBody = {
  account: string;
  capturedAt: string | null;
  completeFollowers: boolean;
  completeFollowing: boolean;
  followers: string[] | null;
  following: string[] | null;
  shards: { followers: number[]; following: number[] };
};

/** The first synthetic export of atlas_studio: both directions, both declared complete. */
export const FIRST_EXPORT: ExportBody = {
  account: "atlas_studio",
  capturedAt: FIRST_CAPTURE,
  completeFollowers: true,
  completeFollowing: true,
  followers: ["nova_labs", "pixel_forge"],
  following: ["lunar_arch", "nova_labs"],
  shards: { followers: [0], following: [0] },
};

/** Nine days later: pixel_forge is gone from the followers, ember_lab is new, the following list is the same. */
export const SECOND_EXPORT: ExportBody = {
  ...FIRST_EXPORT,
  capturedAt: SECOND_CAPTURE,
  followers: ["ember_lab", "nova_labs"],
};

/** One browser: a cookie jar that every request sends and every response updates. */
export class Browser {
  private readonly jar = new Map<string, string>();

  /** The Cookie header this browser sends, or undefined while it holds no cookie. */
  get cookie(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private keep(response: Response): Response {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const at = pair.indexOf("=");
      if (at < 1) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === "" || /;\s*max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return response;
  }

  /** A Better Auth endpoint (a path under /api/auth) or a link taken from a mail. */
  async auth(path: string, call: { json?: unknown; method?: string } = {}): Promise<Response> {
    return this.keep(await authRequest(path, { ...call, cookie: this.cookie }));
  }

  /** A route handler, called the way Next.js calls it. */
  async route(handler: unknown, call: Omit<RouteCall, "cookie">): Promise<Response> {
    return this.keep(await callRoute(handler, { ...call, cookie: this.cookie }));
  }
}

const forProfile = (id: string, path = "", query = "") => ({ url: `/api/profiles/${id}${path}${query}`, params: { id } });

/** Every customer-facing route, by what it does. */
export const api = {
  health: () => callRoute(healthGET, { url: "/api/health", origin: null }),
  me: (b: Browser) => b.route(meGET, { url: "/api/me" }),
  /** The same read with a cookie value that was copied out of a browser. */
  meWith: (cookie: string) => callRoute(meGET, { url: "/api/me", cookie }),
  patchMe: (b: Browser, json: unknown) => b.route(mePATCH, { method: "PATCH", url: "/api/me", json }),
  onboard: (b: Browser, json: unknown) => b.route(onboardingPOST, { method: "POST", url: "/api/me/onboarding", json }),
  profiles: (b: Browser) => b.route(profilesGET, { url: "/api/profiles" }),
  addProfile: (b: Browser, json: unknown) => b.route(profilesPOST, { method: "POST", url: "/api/profiles", json }),
  profile: (b: Browser, id: string) => b.route(profileGET, forProfile(id)),
  setStatus: (b: Browser, id: string, json: unknown) => b.route(profilePATCH, { method: "PATCH", ...forProfile(id), json }),
  removeProfile: (b: Browser, id: string) => b.route(profileDELETE, { method: "DELETE", ...forProfile(id) }),
  importExport: (b: Browser, id: string, json: unknown) =>
    b.route(importPOST, { method: "POST", ...forProfile(id, "/imports"), json }),
  snapshots: (b: Browser, id: string) => b.route(snapshotsGET, forProfile(id, "/snapshots")),
  relationships: (b: Browser, id: string) => b.route(relationshipsGET, forProfile(id, "/relationships")),
  events: (b: Browser, id: string) => b.route(eventsGET, forProfile(id, "/events")),
  counts: (b: Browser, id: string) => b.route(countsGET, forProfile(id, "/counts")),
  review: (b: Browser, id: string) => b.route(reviewPOST, { method: "POST", ...forProfile(id, "/review") }),
  activity: (b: Browser, query = "") => b.route(activityGET, { url: `/api/activity${query}` }),
  download: (b: Browser) => b.route(exportGET, { url: "/api/account/export" }),
  adminUsers: (b: Browser) => b.route(usersGET, { url: "/api/admin/users" }),
  adminCapacity: (b: Browser) => b.route(capacityGET, { url: "/api/admin/capacity" }),
  /** The batch endpoint as a scheduler calls it: no cookie, no Origin, and the credential given here. */
  tick: (authorization?: string) =>
    callRoute(tickPOST, {
      method: "POST",
      url: "/api/jobs/tick",
      origin: null,
      headers: authorization === undefined ? {} : { authorization },
    }),
};

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/**
 * True when no background work is running, found without giving the event
 * loop a turn. With nothing queued, settleBackground resolves within a few
 * microtask turns. Work that waits on the database cannot finish before the
 * loop turns, and only microtask turns are given here, so it is still running.
 */
async function backgroundIdle(): Promise<boolean> {
  let idle = false;
  void settleBackground().then(() => {
    idle = true;
  });
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  return idle;
}

/** What watchBackground saw around one call of the handler. */
export interface BackgroundSeen {
  /** No background work was running when the request arrived. */
  idleBefore: boolean;
  /** Background work the handler started was still running when its response was ready. */
  runningAfter: boolean;
}

/**
 * Wrap a route handler to see whether its response was ready before the
 * background work it started had finished. Pass `handler` to Browser.route in
 * place of the real one; `seen` is filled in when the real handler answers.
 * Browser.route still waits for that work before it returns.
 */
export function watchBackground(real: unknown): { handler: Handler; seen: () => BackgroundSeen | null } {
  let seen: BackgroundSeen | null = null;
  const handler: Handler = async (request, context) => {
    const idleBefore = await backgroundIdle();
    const response = await (real as Handler)(request, context);
    seen = { idleBefore, runningAfter: !(await backgroundIdle()) };
    return response;
  };
  return { handler, seen: () => seen };
}

/** Parse a JSON response after checking its status. */
export async function body<T>(response: Response, status = 200): Promise<T> {
  const text = await response.text();
  expect({ status: response.status, body: response.status === status ? "" : text }).toEqual({ status, body: "" });
  return JSON.parse(text) as T;
}

export const tickSecret = (): string => `Bearer ${process.env.JOBS_TICK_SECRET}`;

/** One run of the batch endpoint with the right secret. Returns its summary. */
export async function runBatch(): Promise<TickSummaryDto> {
  return body<TickSummaryDto>(await api.tick(tickSecret()));
}

/**
 * Run something with the clock of this process set to an instant, as if it
 * happened then. Only Date is replaced; timers and the database are real.
 */
export async function at<T>(instant: string | Date, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(instant) });
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

export interface CapturedMessage {
  kind: string;
  subject: string;
  text: string;
  to: string;
}

/** The captured mail for an address, newest first, read through the mailbox endpoint with its secret. */
export async function mailbox(to: string): Promise<CapturedMessage[]> {
  const response = await callRoute(mailboxGET, {
    url: `/api/staging/mailbox?to=${encodeURIComponent(to)}`,
    origin: null,
    headers: { authorization: `Bearer ${process.env.MAILBOX_SECRET}` },
  });
  return (await body<Page<CapturedMessage>>(response)).data;
}

/** The link in the newest captured mail of one kind for an address. */
export async function mailLink(to: string, kind: "verify_email" | "reset_password"): Promise<string> {
  const mail = (await mailbox(to)).find((message) => message.kind === kind);
  if (!mail) throw new Error(`no ${kind} mail was captured`);
  return extractLink(mail);
}

export interface Customer {
  browser: Browser;
  email: string;
  userId: string;
}

/** Sign in from a browser with the password every test account uses, or another one. */
export function signInFrom(browser: Browser, email: string, password: string = TEST_PASSWORD): Promise<Response> {
  return browser.auth("/sign-in/email", { json: { email, password } });
}

const ONBOARDING = { termsVersion: CONSENT_VERSIONS.terms, privacyVersion: CONSENT_VERSIONS.privacy };

/**
 * A customer who is ready to work, reached the way a person gets there: sign
 * up with consent, open the link from the captured mail, sign in from the same
 * browser, finish onboarding, and pick a review hour. The review hour is set
 * twelve hours away from now, so a batch run at the real time never finds a
 * daily review due by accident.
 */
export async function register(email: string, name = "Atlas Tester"): Promise<Customer> {
  const browser = new Browser();
  expect((await signUp({ email, name })).status).toBe(200);
  expect((await browser.auth(await mailLink(email, "verify_email"))).status).toBe(302);
  const signedIn = await body<{ user: { id: string } }>(await signInFrom(browser, email));
  await body<MeDto>(await api.onboard(browser, ONBOARDING));
  const reviewHour = (new Date().getUTCHours() + 12) % 24;
  await body<MeDto>(await api.patchMe(browser, { timezone: "UTC", reviewHour }));
  return { browser, email, userId: signedIn.user.id };
}

/** Add a profile and return it. */
export async function addProfile(browser: Browser, handle: string): Promise<ProfileDto> {
  return body<ProfileDto>(await api.addProfile(browser, { handle }), 201);
}

/**
 * Import an export through a watched import handler. Returns the response and
 * what was seen when the handler answered. The handler defaults to the real
 * import route.
 */
export async function importWatched(
  browser: Browser,
  profileId: string,
  payload: ExportBody,
  real: unknown = importPOST,
): Promise<{ response: Response; seen: BackgroundSeen | null }> {
  const watched = watchBackground(real);
  const response = await browser.route(watched.handler, { method: "POST", ...forProfile(profileId, "/imports"), json: payload });
  return { response, seen: watched.seen() };
}

/** Import an export that changes the history: answers 201 with the receipt. */
export async function importInto(browser: Browser, profileId: string, payload: ExportBody): Promise<ImportReceiptDto> {
  return body<ImportReceiptDto>(await api.importExport(browser, profileId, payload), 201);
}

export async function readProfile(browser: Browser, profileId: string): Promise<ProfileDto> {
  return body<ProfileDto>(await api.profile(browser, profileId));
}

export async function readEvents(browser: Browser, profileId: string): Promise<Page<ExportEventDto>> {
  return body<Page<ExportEventDto>>(await api.events(browser, profileId));
}

export async function readActivity(browser: Browser, query = ""): Promise<Page<ActivityDto>> {
  return body<Page<ActivityDto>>(await api.activity(browser, query));
}

/** The kinds in a feed, sorted, so an assertion does not depend on timestamps that are equal. */
export function kinds(feed: Page<ActivityDto>): string[] {
  return feed.data.map((entry) => entry.kind).sort();
}
