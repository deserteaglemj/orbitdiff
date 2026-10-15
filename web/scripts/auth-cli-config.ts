import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { authSchemaOptions } from "../src/server/auth/options";

// Used only by the Better Auth CLI to generate src/server/db/auth-schema.ts.
export const auth = betterAuth({
  ...authSchemaOptions,
  database: drizzleAdapter({}, { provider: "pg" }),
});
