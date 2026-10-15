import { configurationStatus } from "@/server/configuration";
import { json, route } from "@/server/http/handler";
import { getHealth } from "@/server/http/health";

export const dynamic = "force-dynamic";

/**
 * Public. Anyone may call it; it returns no secret and no account data.
 *
 * A deployment that is not configured yet (for example no DATABASE_URL) answers
 * 503 `{ status: "unconfigured", missing: [...] }`. `missing` holds variable
 * names only, never a value. Registration is closed in that state.
 *
 * Otherwise `registration` comes from getRegistrationState(), the same function
 * the sign-up gate calls, so what is reported here is what the gate will do.
 */
export const GET = route(async () => {
  const status = configurationStatus();
  if (!status.configured) {
    return json({ status: "unconfigured", missing: status.missing }, { status: 503 });
  }
  const health = await getHealth();
  return json(health, { status: health.database.ok ? 200 : 503 });
});
