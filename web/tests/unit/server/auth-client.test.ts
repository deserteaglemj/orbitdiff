import { describe, expect, it } from "vitest";

import { authClient, SIGNUP_CODE_HEADER } from "@/lib/auth-client";

/** Type-level contract. Checked by `yarn typecheck`; never executed. */
export async function typeContract(): Promise<void> {
  await authClient.signUp.email({
    name: "Atlas",
    email: "atlas@orbitdiff.test",
    password: "orbit-test-pw-1",
    timezone: "UTC",
    acceptedTermsVersion: "2026-09-30",
    marketingOptIn: false,
  });
  await authClient.signUp.email({
    name: "Atlas",
    email: "atlas@orbitdiff.test",
    password: "orbit-test-pw-1",
    // @ts-expect-error status is not an input field
    status: "suspended",
  });
  await authClient.signUp.email({
    name: "Atlas",
    email: "atlas@orbitdiff.test",
    password: "orbit-test-pw-1",
    // @ts-expect-error reviewHour is not an input field
    reviewHour: 3,
  });
  const session = await authClient.getSession();
  const status: string | null | undefined = session.data?.user.status;
  void status;
}

describe("browser auth client", () => {
  it("exposes the email and password flows", () => {
    expect(typeof authClient.signUp.email).toBe("function");
    expect(typeof authClient.signIn.email).toBe("function");
    expect(typeof authClient.signOut).toBe("function");
    expect(typeof authClient.requestPasswordReset).toBe("function");
    expect(typeof authClient.resetPassword).toBe("function");
    expect(typeof authClient.deleteUser).toBe("function");
    expect(typeof authClient.useSession).toBe("function");
  });

  it("names the header that carries the sign-up access code", () => {
    expect(SIGNUP_CODE_HEADER).toBe("x-signup-code");
  });
});
