import { requireOnboardedUser } from "@/server/auth/guards";
import { parsePagination } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { listEvents } from "@/server/services/events";
import { QUERY_CHOICES, queryChoice } from "@/server/services/request-input";
import { requireUuid } from "@/server/services/shared";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Export observations of a profile of the signed-in user, with `type`, `q`,
 * `page`, and `pageSize`. Each entry is a difference between two dated
 * exports, labelled `export_observation`. A malformed, unknown, or foreign id
 * answers `not_found`.
 */
export const GET = route<Context>(async (request, { params }) => {
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  const query = new URL(request.url).searchParams;
  const page = parsePagination(query);
  return json(
    await listEvents(user.id, {
      profileId: id,
      type: queryChoice(query, "type", QUERY_CHOICES.eventType),
      q: query.get("q"),
      page: page.page,
      pageSize: page.pageSize,
    }),
  );
});
