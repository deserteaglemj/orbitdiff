import type { BetterAuthOptions } from "better-auth";

/**
 * Schema-affecting Better Auth options. Kept free of runtime configuration so the
 * Better Auth CLI can generate the Drizzle schema without a database or secrets.
 */
export const authSchemaOptions = {
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  rateLimit: { enabled: true, storage: "database" },
  user: {
    deleteUser: { enabled: true },
    additionalFields: {
      timezone: { type: "string", required: false, defaultValue: "UTC", input: true },
      acceptedTermsVersion: { type: "string", required: false, input: true },
      marketingOptIn: { type: "boolean", required: false, defaultValue: false, input: true },
      reviewHour: { type: "number", required: false, defaultValue: 9, input: false },
      status: { type: "string", required: false, defaultValue: "active", input: false },
      onboardedAt: { type: "date", required: false, input: false },
    },
  },
} satisfies BetterAuthOptions;
