import { inject } from "vitest";

// Deterministic, non-secret configuration for the integration test process.
const filler = "test-only-".repeat(4);
process.env.APP_STAGE = "test";
process.env.APP_BASE_URL = "http://127.0.0.1:3100";
process.env.DATABASE_URL = inject("databaseUrl");
process.env.BETTER_AUTH_SECRET = `${filler}auth`;
process.env.JOBS_TICK_SECRET = `${filler}jobs`;
process.env.MAILBOX_SECRET = `${filler}mail`;
process.env.EMAIL_TRANSPORT = "capture";
process.env.ADMIN_EMAILS = "owner@orbitdiff.test";
