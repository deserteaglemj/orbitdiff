import { requireOnboardedUser } from "@/server/auth/guards";
import { parsePagination } from "@/server/http";
import { json, route } from "@/server/http/handler";
import { listActivity } from "@/server/services/activity";
import { QUERY_CHOICES, queryChoice } from "@/server/services/request-input";

export const dynamic = "force-dynamic";

/**
 * The activity feed of the signed-in user, with `profileId`, `kind`, `status`,
 * `q`, `page`, and `pageSize`. Who may call it: an onboarded user. A
 * `profileId` that is malformed, unknown, or belongs to another user answers
 * `not_found`.
 */
export const GET = route(async (request) => {
  const user = await requireOnboardedUser(request.headers);
  const query = new URL(request.url).searchParams;
  const page = parsePagination(query);
  return json(
    await listActivity(user.id, {
      profileId: query.get("profileId") || null,
      kind: queryChoice(query, "kind", QUERY_CHOICES.activityKind),
      status: queryChoice(query, "status", QUERY_CHOICES.activityStatus),
      q: query.get("q"),
      page: page.page,
      pageSize: page.pageSize,
    }),
  );
});
