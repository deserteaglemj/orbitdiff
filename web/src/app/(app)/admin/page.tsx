import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { AdminScreen } from "@/components/admin/admin-screen";
import { adminMetadata } from "@/components/admin/page-metadata";
import { requireAdmin, requireOnboardedUser, type SessionUser } from "@/server/auth/guards";
import { resolvePageAccess } from "@/server/auth/page-access";
import { ONBOARDING_PATH } from "@/server/auth/paths";
import { configurationStatus } from "@/server/configuration";
import { AppError } from "@/server/http/errors";
import { getCapacity, listUsers } from "@/server/services/admin";

const ADMIN_PATH = "/admin";

/**
 * The admin of this request, or null for everyone else. requireAdmin passes
 * only for a verified, active user whose address is in ADMIN_EMAILS and throws
 * `not_found` for every other request, with or without a session. It reads the
 * session from the database, so nothing here trusts a cookie, a header, or an
 * earlier answer. `cache` makes the title and the page share one read per request.
 */
const readAdmin = cache(async (): Promise<SessionUser | null> => {
  // A deployment without its configuration has no accounts, so it has no admin either.
  if (!configurationStatus().configured) return null;
  try {
    return await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof AppError && error.code === "not_found") return null;
    throw error;
  }
});

/**
 * True when the signed-in layout renders the suspended notice in place of this
 * page. It is the layout's own decision (resolvePageAccess), asked again, so
 * the title cannot disagree with what the layout shows.
 */
async function layoutShowsSuspendedNotice(): Promise<boolean> {
  const access = await resolvePageAccess(await headers(), ADMIN_PATH);
  return access.kind === "suspended";
}

/**
 * The title follows what the visitor is shown (adminMetadata):
 *
 * - "Admin" for the admin only;
 * - "Account suspended" for a suspended account: the layout renders the
 *   suspended notice in place of this page, and this title still applies to it;
 * - the title of the not-found page for everyone else, which is the page this
 *   function answers them with.
 *
 * Nobody but the admin gets the word "Admin". Do not give this page a static
 * `metadata` title.
 */
export async function generateMetadata(): Promise<Metadata> {
  if ((await readAdmin()) !== null) return adminMetadata("admin");
  return adminMetadata((await layoutShowsSuspendedNotice()) ? "suspended" : "other");
}

/** True when the admin has finished onboarding and the recorded consent is current. */
async function isOnboarded(requestHeaders: Headers): Promise<boolean> {
  try {
    await requireOnboardedUser(requestHeaders);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === "conflict" && error.details?.onboarding === true) return false;
    throw error;
  }
}

/**
 * The operator's page. Who may open it: only the admin.
 *
 * What this function answers: notFound() for every request that does not pass
 * requireAdmin. A signed-in account that is not the admin therefore gets the
 * same page, with status 404, as for an address that does not exist. There is
 * no "forbidden" page, and no admin data has been read at that point: the
 * services below run only after the guard passed, they take the admin's id
 * first, and they check it again themselves.
 *
 * What a visitor gets is not always decided here. /admin is one of the
 * signed-in areas, so on a full page load two things answer before this
 * function runs:
 *
 * - the proxy sends a request without a session cookie to sign-in;
 * - the signed-in layout sends a cookie that is not a valid session to
 *   sign-in, an address that is not verified to the verify page, and an
 *   account that is not onboarded to onboarding, and it shows a suspended
 *   account the suspended notice in place of this page.
 *
 * So the 404 is the answer for a signed-in, verified, active, onboarded
 * account that is not the admin. The earlier answers differ from the answer
 * for an address that does not exist; they carry no admin data. The whole
 * table is in docs/web/interface.md, section 11.
 *
 * On a navigation inside the app the layout is not rendered again and this
 * function answers alone, which is why the guard is called here and not only
 * in the layout.
 *
 * Read only: nothing here changes an account.
 *
 * This segment has no loading file on purpose: a streamed response could not
 * answer with status 404.
 */
export default async function AdminPage() {
  const admin = await readAdmin();
  if (admin === null) notFound();
  // Like every signed-in page: onboarding and the current documents come first, for the admin too.
  if (!(await isOnboarded(await headers()))) redirect(ONBOARDING_PATH);

  const now = new Date();
  const [capacity, users] = await Promise.all([getCapacity(admin.id, now), listUsers(admin.id, { page: 1 }, now)]);
  return <AdminScreen capacity={capacity} users={users} now={now.toISOString()} />;
}
