import { requireAdmin } from "@/server/auth/guards";
import { json, route } from "@/server/http/handler";
import { getCapacity } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/**
 * Global capacity against the configured limits: counts and flags only.
 * Who may call it: only a verified, active user whose address is in
 * ADMIN_EMAILS. Everyone else, signed in or not, gets `not_found`.
 */
export const GET = route(async (request) => {
  const admin = await requireAdmin(request.headers);
  return json(await getCapacity(admin.id));
});
