import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSignUpRequest } from "@/components/auth/sign-up-model";
import { CONSENT_VERSIONS } from "@/domain/limits";
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

  it("documents every field the sign-up form sends, the privacy version beside the terms version", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../../../src/lib/auth-client.ts"), "utf8");
    const comment = /\/\*\*[\s\S]*?\*\//.exec(source)?.[0] ?? "";
    const sent = buildSignUpRequest(
      {
        name: "Atlas",
        email: "atlas@orbitdiff.test",
        password: "orbit-test-pw-1",
        timezone: "UTC",
        accessCode: "",
        acceptTerms: true,
        marketing: false,
      },
      { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy },
    );
    for (const field of Object.keys(sent.body)) expect(comment, field).toContain(field);
    expect(comment).toMatch(/acceptedTermsVersion, acceptedPrivacyVersion/);
  });
});
