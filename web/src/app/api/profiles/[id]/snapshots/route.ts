import { requireOnboardedUser } from "@/server/auth/guards";
import { parsePagination } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { listSnapshots } from "@/server/services/imports";
import { requireUuid } from "@/server/services/shared";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Import history of a profile of the signed-in user, without rosters.
 * A malformed, unknown, or foreign id answers `not_found`.
 */
export const GET = route<Context>(async (request, { params }) => {
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  const page = parsePagination(new URL(request.url).searchParams);
  return json(await listSnapshots(user.id, id, page));
});
