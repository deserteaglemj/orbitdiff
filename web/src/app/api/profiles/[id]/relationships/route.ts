import { requireOnboardedUser } from "@/server/auth/guards";
import { parsePagination } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { listRelationships } from "@/server/services/relationships";
import { QUERY_CHOICES, queryChoice } from "@/server/services/request-input";
import { requireUuid } from "@/server/services/shared";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Accounts of the current export of a profile of the signed-in user, with
 * `q`, `relationship`, `page`, and `pageSize`. A malformed, unknown, or
 * foreign id answers `not_found`.
 */
export const GET = route<Context>(async (request, { params }) => {
  const user = await requireOnboardedUser(request.headers);
  const id = requireUuid((await params).id);
  const query = new URL(request.url).searchParams;
  const page = parsePagination(query);
  return json(
    await listRelationships(user.id, id, {
      q: query.get("q"),
      relationship: queryChoice(query, "relationship", QUERY_CHOICES.relationship),
      page: page.page,
      pageSize: page.pageSize,
    }),
  );
});
