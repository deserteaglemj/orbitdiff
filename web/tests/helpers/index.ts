/**
 * Helpers for integration tests. Typical file:
 *
 *   beforeEach(resetDatabase);
 *   afterEach(restoreTestEnv);
 *   afterAll(closeDb);            // from "@/server/db/client"
 *
 *   const atlas = await createVerifiedUser({ email: "atlas@orbitdiff.test", onboarded: true });
 *   const response = await callRoute(GET, { url: "/api/profiles", cookie: atlas.cookie });
 */
export {
  authRequest,
  createVerifiedUser,
  markOnboarded,
  openVerificationLink,
  signIn,
  signUp,
  TEST_PASSWORD,
} from "./auth";
export type { AuthCall, SignUpInput, VerifiedUser } from "./auth";
export { resetDatabase } from "./db";
export { restoreTestEnv, setTestEnv } from "./env";
export { callRoute, cookieHeader } from "./http";
export type { RouteCall } from "./http";
export { extractLink, latestMail } from "./mail";
export type { CapturedMail, CapturedMailKind } from "./mail";
