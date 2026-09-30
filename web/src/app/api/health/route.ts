import { json, route } from "@/server/http/handler";
import { getHealth } from "@/server/http/health";

export const dynamic = "force-dynamic";

/** Public. Anyone may call it; it returns no secret and no account data. */
export const GET = route(async () => {
  const health = await getHealth();
  return json(health, { status: health.database.ok ? 200 : 503 });
});
