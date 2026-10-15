import { EnvError, getEnv } from "@/server/env";
import { bearerToken, constantTimeEqual } from "@/server/http/compare";
import { AppError } from "@/server/http/errors";
import { json, route } from "@/server/http/handler";
import { runTick } from "@/server/jobs/tick";

export const dynamic = "force-dynamic";
/** One tick drains inside LIMITS.tickBudgetMs; the rest is bookkeeping. */
export const maxDuration = 60;

/** The configured batch secret, or null on a deployment that is not configured. */
function batchSecret(): string | null {
  try {
    return getEnv().jobsTickSecret;
  } catch (error) {
    if (error instanceof EnvError) return null;
    throw error;
  }
}

/**
 * The protected batch endpoint: one bounded run of the job queue.
 *
 * Who may call it: only a holder of JOBS_TICK_SECRET, sent as
 * `Authorization: Bearer <secret>` and compared in constant time. The caller is
 * a scheduler, not a browser, so there is no cookie session and no Origin
 * check here. Every other request, signed in or not, gets the same 404 as a
 * route that does not exist, so the endpoint is not advertised.
 *
 * What it returns: the tick summary, which holds counts and flags only. It
 * never returns account data, and the jobs it runs never contact Instagram or
 * any other host: they process stored imports and review stored evidence.
 *
 * It is safe to call again, and to call twice at once.
 */
const tick = route(async (request) => {
  const secret = batchSecret();
  const presented = bearerToken(request);
  if (secret === null || presented === null || !constantTimeEqual(presented, secret)) {
    throw new AppError("not_found", "Not found.");
  }
  return json(await runTick({ now: new Date() }));
});

export const POST = tick;
/** For a scheduler that can only send GET. Same credential, same work. */
export const GET = tick;
