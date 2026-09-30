import { requireAdmin } from "@/server/auth/guards";
import { parsePagination } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { listUsers } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/**
 * Accounts with their usage, for the operator, with `q`, `page`, `pageSize`.
 * Who may call it: only a verified, active user whose address is in
 * ADMIN_EMAILS. Everyone else, signed in or not, gets `not_found`. The output
 * holds no credential, no handle, and no roster.
 */
export const GET = route(async (request) => {
  const admin = await requireAdmin(request.headers);
  const query = new URL(request.url).searchParams;
  const page = parsePagination(query);
  return json(await listUsers(admin.id, { q: query.get("q"), page: page.page, pageSize: page.pageSize }));
});
