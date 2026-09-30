import type { ApiResult } from "@/components/onboarding/api";
import { formatBytes, formatDateTime } from "@/components/settings/format";
import { formatCount } from "@/components/ui/format";
import type { AdminUserDto, ConsentStateDto, Page } from "@/server/services/contracts";

/**
 * The accounts table of the admin screen: the address of a page of the list,
 * the check of what the route answered, and the wording of one row. Pure
 * functions with no I/O.
 *
 * A row is built field by field from the account the route returned, so a
 * value the screen has no column for can never reach the page. The route sends
 * no password, token, roster, or Instagram username in the first place.
 */
type Flag = { label: string; tone: "ok" | "warning" | "neutral" };
type ConsentEntry = ConsentStateDto["terms"];

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  signedUp: string;
  verified: Flag;
  status: Flag;
  onboarding: Flag;
  terms: string;
  privacy: string;
  marketing: string;
  profiles: string;
  snapshots: string;
  storedBytes: string;
  imports: string;
  jobs: string;
  lastActivity: string;
}

const NOT_RECORDED = "Not recorded";

/** The recorded acceptance of a document: its version and the time of the newest record. */
function documentConsent(entry: ConsentEntry): string {
  if (!entry) return NOT_RECORDED;
  const verb = entry.granted === true ? "accepted" : "withdrawn";
  return `Version ${entry.version}, ${verb} ${formatDateTime(entry.recordedAt, "UTC")}`;
}

function marketingConsent(entry: ConsentEntry): string {
  if (!entry) return NOT_RECORDED;
  const when = formatDateTime(entry.recordedAt, "UTC");
  return entry.granted === true ? `On since ${when}, version ${entry.version}` : `Off since ${when}`;
}

/** One account as the table words it. Times are in UTC, because the operator reads accounts from every timezone. */
export function adminUserRow(user: AdminUserDto): AdminUserRow {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    signedUp: formatDateTime(user.createdAt, "UTC"),
    verified: user.emailVerified === true ? { label: "Verified", tone: "ok" } : { label: "Not verified", tone: "warning" },
    status: user.status === "active" ? { label: "Active", tone: "ok" } : { label: "Suspended", tone: "warning" },
    onboarding: user.onboarded === true ? { label: "Onboarded", tone: "ok" } : { label: "Not onboarded", tone: "neutral" },
    terms: documentConsent(user.consent.terms),
    privacy: documentConsent(user.consent.privacy),
    marketing: marketingConsent(user.consent.marketing),
    profiles: formatCount(user.usage.profiles),
    snapshots: formatCount(user.usage.snapshots),
    storedBytes: formatBytes(user.usage.rosterBytes),
    imports: formatCount(user.usage.importsLast30Days),
    jobs: formatCount(user.usage.jobsLast30Days),
    lastActivity: user.usage.lastActivityAt ? formatDateTime(user.usage.lastActivityAt, "UTC") : "None yet",
  };
}

/** Longest search text the accounts route accepts. */
export const ADMIN_SEARCH_MAX = 100;

export function validateSearch(q: string): string | undefined {
  return q.trim().length > ADMIN_SEARCH_MAX ? `Use at most ${ADMIN_SEARCH_MAX} characters.` : undefined;
}

/** The address of one page of GET /api/admin/users. The search text is always encoded. */
export function adminUsersPath(query: { q: string; page: number }): string {
  const page = Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
  const params = new URLSearchParams({ page: String(page) });
  const q = query.q.trim();
  if (q.length > 0) params.set("q", q);
  return `/api/admin/users?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PAGINATION_KEYS = ["page", "pageSize", "totalItems", "totalPages"] as const;

/** The answer of the accounts route as a page, or null when it is not in the list shape. */
export function readUsersPage(value: unknown): Page<AdminUserDto> | null {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) return null;
  const pagination = value.pagination;
  if (!PAGINATION_KEYS.every((key) => typeof pagination[key] === "number" && Number.isFinite(pagination[key]))) {
    return null;
  }
  const accounts = value.data.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.email === "string" &&
      isRecord(entry.consent) &&
      isRecord(entry.usage),
  );
  return accounts ? (value as unknown as Page<AdminUserDto>) : null;
}

export type UsersLoad =
  | { ok: true; page: Page<AdminUserDto> }
  /** `field` is "q" when the refusal is about the search text. */
  | { ok: false; field: "q" | null; message: string };

const UNREADABLE = "The server answered in a form this page cannot read. Reload the page.";

/**
 * Read one page of accounts through GET /api/admin/users. `get` is the call
 * that reaches the route (getJson in the browser). A refusal keeps the route's
 * own message, and an answer that is not a list of accounts is never shown.
 */
export async function loadUsers(
  get: (path: string) => Promise<ApiResult<unknown>>,
  query: { q: string; page: number },
): Promise<UsersLoad> {
  const result = await get(adminUsersPath(query));
  if (!result.ok) return { ok: false, field: result.fields.includes("q") ? "q" : null, message: result.message };
  const page = readUsersPage(result.data);
  return page === null ? { ok: false, field: null, message: UNREADABLE } : { ok: true, page };
}

/** One sentence on what the table shows, for the line above it and for the live region. */
export function describeResultCount(pagination: Page<AdminUserDto>["pagination"], q: string): string {
  const search = q.trim();
  const total = pagination.totalItems;
  if (total <= 0) return search.length > 0 ? `No account matches "${search}".` : "There are no accounts.";
  if (total === 1) return search.length > 0 ? `Showing 1 account that matches "${search}".` : "Showing 1 account.";
  const matching = search.length > 0 ? ` that match "${search}"` : "";
  const first = (pagination.page - 1) * pagination.pageSize + 1;
  const last = Math.min(pagination.page * pagination.pageSize, total);
  return `Showing ${formatCount(first)} to ${formatCount(last)} of ${formatCount(total)} accounts${matching}.`;
}
