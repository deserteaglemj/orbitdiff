import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import PrivacyPage from "@/app/legal/privacy/page";
import TermsPage from "@/app/legal/terms/page";
import { ForgotPasswordScreen } from "@/components/auth/forgot-password-screen";
import { ResetPasswordScreen } from "@/components/auth/reset-password-screen";
import { SignInScreen } from "@/components/auth/sign-in-screen";
import { SignUpScreen } from "@/components/auth/sign-up-screen";
import { SuspendedScreen } from "@/components/auth/suspended-screen";
import { VerifyEmailScreen } from "@/components/auth/verify-email-screen";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { CONSENT_VERSIONS } from "@/domain/limits";
import type { ConsentStateDto } from "@/server/services/contracts";

import { htmlToText, sectionText } from "../components/support/render";

function render<P extends object>(component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(component, props));
}

/** Every input, select, and textarea tag in the markup. */
function controls(html: string): string[] {
  return html.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? [];
}

function control(html: string, name: string): string {
  const found = controls(html).find((tag) => tag.includes(`name="${name}"`));
  if (!found) throw new Error(`no control named ${name}`);
  return found;
}

const names = (html: string) =>
  controls(html)
    .map((tag) => /name="([^"]+)"/.exec(tag)?.[1] ?? "")
    .sort();

const OPEN = { configured: true, open: true, reason: null, accessCodeRequired: false, mailCaptured: true };
const TIMEZONES = ["UTC", "Europe/Berlin", "America/Chicago"];
const signUp = (registration: typeof OPEN | Record<string, unknown> = OPEN) =>
  render(SignUpScreen, {
    registration: registration as typeof OPEN,
    termsVersion: CONSENT_VERSIONS.terms,
    privacyVersion: CONSENT_VERSIONS.privacy,
    timezones: TIMEZONES,
  });
/** The versions a rendered onboarding page shows. */
const VERSIONS = { terms: CONSENT_VERSIONS.terms, privacy: CONSENT_VERSIONS.privacy };

const EM_DASH = String.fromCharCode(0x2014);

describe("sign-up screen", () => {
  const html = signUp();
  const text = htmlToText(html);

  it("asks for exactly the account fields and nothing about Instagram", () => {
    expect(names(html)).toEqual(["acceptTerms", "email", "marketing", "name", "password", "timezone"]);
    expect(text).toContain("OrbitDiff Web never asks for your Instagram password");
  });

  it("labels every field and marks the required ones", () => {
    for (const label of ["Display name (required)", "Email address (required)", "Password (required)", "Timezone (required)"]) {
      expect(text).toContain(label);
    }
    for (const tag of controls(html)) {
      const id = /id="([^"]+)"/.exec(tag)?.[1];
      expect(id, tag).toBeTruthy();
      expect(html).toContain(`for="${id}"`);
    }
  });

  it("does not call the display name optional, because the server rejects a blank one", () => {
    expect(control(html, "name")).toContain("required");
    expect(text).not.toMatch(/display name[^.]*optional/i);
  });

  it("sets a minimum password length of 10 and lets a password manager fill it in", () => {
    const password = control(html, "password");
    expect(password).toContain('type="password"');
    expect(password).toContain('minLength="10"');
    expect(password).toContain('autoComplete="new-password"');
    expect(text).toContain("At least 10 characters");
  });

  it("uses the right keyboard and autofill hints for the email address", () => {
    const email = control(html, "email");
    expect(email).toContain('type="email"');
    expect(email).toContain('autoComplete="email"');
    expect(email).toContain('spellCheck="false"');
  });

  it("has one required, unticked box for the Terms and the Privacy notice, with both links", () => {
    const box = control(html, "acceptTerms");
    expect(box).toContain('type="checkbox"');
    expect(box).toContain("required");
    expect(box).not.toMatch(/\bchecked\b/);
    expect(text).toContain("I agree to the Terms and the Privacy notice");
    expect(html).toContain('href="/legal/terms"');
    expect(html).toContain('href="/legal/privacy"');
    expect(text).toContain(`Terms version ${CONSENT_VERSIONS.terms}`);
    expect(text).toContain(`Privacy notice version ${CONSENT_VERSIONS.privacy}`);
  });

  it("has a separate, optional, unticked box for product news", () => {
    const box = control(html, "marketing");
    expect(box).toContain('type="checkbox"');
    expect(box).not.toContain("required");
    expect(box).not.toMatch(/\bchecked\b/);
    expect(text).toContain("Send me product news by email");
    expect(text).toContain("Optional.");
  });

  it("explains in one short paragraph what is collected and why", () => {
    expect(text).toContain("What this form collects and why");
    for (const word of ["email address", "password", "display name", "timezone"]) expect(text).toContain(word);
  });

  it("offers the timezones it was given", () => {
    for (const zone of TIMEZONES) expect(html).toContain(`<option value="${zone}"`);
  });

  it("shows the access code field only when registration needs one", () => {
    expect(names(html)).not.toContain("accessCode");
    const withCode = signUp({ ...OPEN, accessCodeRequired: true });
    expect(names(withCode)).toContain("accessCode");
    expect(htmlToText(withCode)).toContain("Access code (required)");
  });

  it("says plainly when account messages are stored instead of sent", () => {
    expect(text).toContain("stores account messages instead of sending them");
    expect(text).not.toMatch(/we (will )?(send|sent)|check your inbox/i);
    const delivered = htmlToText(signUp({ ...OPEN, mailCaptured: false }));
    expect(delivered).not.toContain("stores account messages instead of sending them");
  });

  it("has a form-level error region and one submit button", () => {
    expect(html).toContain("<form");
    expect(html).toContain("noValidate");
    expect((html.match(/type="submit"/g) ?? []).length).toBe(1);
    expect(text).toContain("Create account");
  });
});

describe("sign-up screen when registration is closed", () => {
  const reasons = [
    "Registration is closed: the operator of this service has not been named yet.",
    "Registration is closed: storage is not configured.",
    "Registration is closed: email delivery is not configured.",
    "Registration is paused: capacity reached.",
  ];

  it.each(reasons)("shows the reason instead of the form: %s", (reason) => {
    const html = signUp({ open: false, reason, accessCodeRequired: false, mailCaptured: false });
    expect(htmlToText(html)).toContain(reason);
    expect(html).not.toContain("<form");
    expect(controls(html)).toEqual([]);
    expect(html).toContain('href="/sign-in"');
  });

  it("still shows no form when the reason is missing", () => {
    const html = signUp({ open: false, reason: null, accessCodeRequired: false, mailCaptured: false });
    expect(html).not.toContain("<form");
    expect(htmlToText(html)).toContain("Registration is closed.");
  });

  it("treats anything but open true as closed", () => {
    for (const open of [undefined, null, "true", 1]) {
      const html = signUp({ open, reason: null, accessCodeRequired: false, mailCaptured: true });
      expect(html, String(open)).not.toContain("<form");
    }
  });
});

describe("sign-in screen", () => {
  const html = render(SignInScreen, { configured: true, next: "/settings", mailCaptured: true, notice: null });
  const text = htmlToText(html);

  it("asks for the email address and the password only", () => {
    expect(names(html)).toEqual(["email", "password"]);
    expect(control(html, "password")).toContain('autoComplete="current-password"');
    expect(control(html, "email")).toContain('autoComplete="email"');
  });

  it("links to password reset and to account creation", () => {
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain('href="/sign-up"');
    expect(text).toContain("Sign in");
  });

  it("tells a visitor who just opened a confirmation link what to do", () => {
    const opened = htmlToText(render(SignInScreen, { configured: true, next: null, mailCaptured: true, notice: "confirm" }));
    expect(opened).toContain("Sign in with your password to confirm your email address");
  });

  it("tells a visitor whose password was reset that they can sign in", () => {
    const reset = htmlToText(render(SignInScreen, { configured: true, next: null, mailCaptured: false, notice: "reset" }));
    expect(reset).toContain("Your password was changed");
  });
});

describe("account screens on a deployment that is not configured", () => {
  const NOTICE = "This deployment is not configured yet.";

  it("show a plain notice in place of the sign-in form", () => {
    const html = render(SignInScreen, { configured: false, next: null, mailCaptured: false, notice: null });
    expect(htmlToText(html)).toContain(NOTICE);
    expect(htmlToText(html)).toContain("Signing in is unavailable until its storage is configured.");
    expect(html).not.toContain("<form");
    expect(controls(html)).toEqual([]);
  });

  it("show a plain notice in place of the reset request form", () => {
    const html = render(ForgotPasswordScreen, { configured: false, mailCaptured: false });
    expect(htmlToText(html)).toContain(NOTICE);
    expect(html).not.toContain("<form");
  });

  it("treat anything but configured true as not configured", () => {
    for (const configured of [undefined, null, "true", 1]) {
      const props = { configured: configured as unknown as boolean, next: null, mailCaptured: false, notice: null };
      expect(render(SignInScreen, props), String(configured)).not.toContain("<form");
    }
  });

  it.each(["waiting", "opened", "invalid"] as const)(
    "show a plain notice in place of the verify page in the %s state, and claim nothing about an account",
    (state) => {
      const html = render(VerifyEmailScreen, { configured: false, state, mailCaptured: false });
      const text = htmlToText(html);
      expect(text).toContain(NOTICE);
      expect(text).toContain("Confirming an email address is unavailable until its storage is configured.");
      expect(html).not.toContain("<form");
      expect(controls(html)).toEqual([]);
      // There is no storage, so no account was created and nothing can be confirmed.
      expect(text).not.toContain("Your account was created");
      expect(text).not.toContain("Request a new confirmation message");
      expect(html).not.toContain('href="/sign-in?confirm=1"');
    },
  );

  it("show a plain notice in place of the new password form, even when the link carries a token", () => {
    const html = render(ResetPasswordScreen, { configured: false, token: "reset-token-for-markup-test", linkError: false });
    const text = htmlToText(html);
    expect(text).toContain(NOTICE);
    expect(text).toContain("Choosing a new password is unavailable until its storage is configured.");
    expect(html).not.toContain("<form");
    expect(controls(html)).toEqual([]);
    expect(html).not.toContain("reset-token-for-markup-test");
  });

  it("treat anything but configured true as not configured on the verify and reset pages too", () => {
    for (const configured of [undefined, null, "true", 1]) {
      const flag = configured as unknown as boolean;
      const verify = render(VerifyEmailScreen, { configured: flag, state: "waiting", mailCaptured: true });
      const reset = render(ResetPasswordScreen, { configured: flag, token: "token", linkError: false });
      for (const html of [verify, reset]) {
        expect(html, String(configured)).not.toContain("<form");
        expect(htmlToText(html), String(configured)).toContain(NOTICE);
      }
    }
  });
});

describe("verify-email screen", () => {
  const view = (state: "waiting" | "opened" | "invalid", mailCaptured: boolean) =>
    htmlToText(render(VerifyEmailScreen, { configured: true, state, mailCaptured }));

  it("tells the visitor to open the link from the confirmation message", () => {
    const text = view("waiting", false);
    expect(text).toContain("Confirm your email address");
    expect(text).toContain("Open the link in the confirmation message");
    expect(text).toContain("The link works for one hour");
  });

  it("says plainly that the message is stored, not sent, where mail is captured", () => {
    const text = view("waiting", true);
    expect(text).toContain("This deployment stores account messages instead of sending them");
    expect(text).toContain("the operator can read");
    expect(text).toContain("Nothing arrives in your inbox");
  });

  it("never claims that an email was sent", () => {
    for (const state of ["waiting", "opened", "invalid"] as const) {
      for (const captured of [true, false]) {
        expect(view(state, captured)).not.toMatch(/we (have |just )?(sent|emailed)|has been sent|was sent to/i);
      }
    }
  });

  it("explains that an opened link still needs the password, and leads to sign-in", () => {
    const html = render(VerifyEmailScreen, { configured: true, state: "opened", mailCaptured: false });
    const text = htmlToText(html);
    expect(text).toContain("The link was opened in this browser");
    expect(text).toContain("Sign in with your password to confirm your email address");
    expect(html).toContain('href="/sign-in?confirm=1"');
  });

  it("explains a link that is not valid and offers a new confirmation message", () => {
    const html = render(VerifyEmailScreen, { configured: true, state: "invalid", mailCaptured: false });
    expect(htmlToText(html)).toContain("That confirmation link is not valid or has expired");
    expect(names(html)).toEqual(["email"]);
  });

  it("offers a new confirmation message while waiting", () => {
    expect(names(render(VerifyEmailScreen, { configured: true, state: "waiting", mailCaptured: true }))).toEqual(["email"]);
  });
});

describe("forgot-password screen", () => {
  it("asks for the email address only", () => {
    const html = render(ForgotPasswordScreen, { configured: true, mailCaptured: true });
    expect(names(html)).toEqual(["email"]);
    expect(htmlToText(html)).toContain("This deployment stores account messages instead of sending them");
    expect(html).toContain('href="/sign-in"');
  });
});

describe("reset-password screen", () => {
  const TOKEN = "reset-token-for-markup-test";

  it("asks for the new password twice when the link carries a token, and never prints the token", () => {
    const html = render(ResetPasswordScreen, { configured: true, token: TOKEN, linkError: false });
    expect(names(html)).toEqual(["confirmPassword", "newPassword"]);
    expect(control(html, "newPassword")).toContain('autoComplete="new-password"');
    expect(control(html, "newPassword")).toContain('minLength="10"');
    expect(html).not.toContain(TOKEN);
  });

  it("says the link is not valid when there is no token", () => {
    const html = render(ResetPasswordScreen, { configured: true, token: null, linkError: false });
    expect(controls(html)).toEqual([]);
    expect(htmlToText(html)).toContain("This reset link is not valid or has expired");
    expect(html).toContain('href="/forgot-password"');
  });

  it("says the link is not valid when the link came back with an error, even with a token", () => {
    const html = render(ResetPasswordScreen, { configured: true, token: TOKEN, linkError: true });
    expect(controls(html)).toEqual([]);
    expect(htmlToText(html)).toContain("This reset link is not valid or has expired");
  });
});

describe("suspended screen", () => {
  it("says the account is suspended and shows no account data", () => {
    const html = render(SuspendedScreen, { signOutButton: createElement("button", { type: "button" }, "Sign out") });
    const text = htmlToText(html);
    expect(text).toContain("This account is suspended");
    expect(text).toContain("Sign out");
    expect(html).not.toContain("@");
  });
});

describe("onboarding flow", () => {
  const granted = (kind: "terms" | "privacy") => ({
    granted: true,
    version: CONSENT_VERSIONS[kind],
    recordedAt: "2026-09-30T10:00:00.000Z",
  });
  const consent: ConsentStateDto = { terms: granted("terms"), privacy: granted("privacy"), marketing: null };
  const account = {
    name: "Atlas Tester",
    timezone: "Europe/Berlin",
    reviewHour: 9,
    onboarded: false,
    completedBefore: false,
    profiles: 0,
    consent,
  };
  const flow = (overrides: Partial<typeof account> = {}) =>
    render(OnboardingFlow, { account: { ...account, ...overrides }, timezones: TIMEZONES, versions: VERSIONS });

  /** An account that finished onboarding earlier and whose recorded consent is for an older version. */
  const outdated = (kinds: ReadonlyArray<"terms" | "privacy">): ConsentStateDto => ({
    terms: kinds.includes("terms") ? { ...granted("terms"), version: "2025-01-01" } : granted("terms"),
    privacy: kinds.includes("privacy") ? { ...granted("privacy"), version: "2025-01-01" } : granted("privacy"),
    marketing: null,
  });
  const returning = (kinds: ReadonlyArray<"terms" | "privacy">, profiles: number) =>
    flow({ onboarded: false, completedBefore: true, profiles, consent: outdated(kinds) });

  it("asks a returning user only to agree to the current documents, not for their details again", () => {
    const html = returning(["terms", "privacy"], 2);
    expect(names(html)).toEqual(["privacy", "terms"]);
    const text = htmlToText(html);
    expect(text).toContain("I agree to the Terms");
    expect(text).toContain("I agree to the Privacy notice");
    expect(text).not.toContain("Display name");
    expect(text).not.toContain("Daily review hour");
  });

  it("asks a returning user only for the document whose version went out of date", () => {
    const html = returning(["privacy"], 3);
    expect(names(html)).toEqual(["privacy"]);
    expect(htmlToText(html)).toContain(`version ${CONSENT_VERSIONS.terms}`);
  });

  it("does not present a returning user with a first-run setup or a first profile", () => {
    for (const profiles of [0, 1, 3]) {
      const html = returning(["terms"], profiles);
      const text = htmlToText(html);
      expect(text, String(profiles)).not.toContain("Set up OrbitDiff Web");
      expect(text, String(profiles)).not.toContain("Three short steps");
      expect(text, String(profiles)).not.toContain("Add your first profile");
      expect(text, String(profiles)).not.toContain("First profile");
      expect(html, String(profiles)).not.toContain('aria-label="Setup steps"');
    }
  });

  it("tells a returning user why they are here and that their data is unchanged", () => {
    const text = htmlToText(returning(["terms", "privacy"], 2));
    expect(text).toContain("Agree to the current Terms and Privacy notice");
    expect(text).toContain("no agreement on record for the current version");
    expect(text).toContain("Your profiles and imports are unchanged");
  });

  it("keeps the first-run setup for an account that never completed onboarding, even with outdated consent", () => {
    const html = flow({ onboarded: false, completedBefore: false, consent: outdated(["terms"]) });
    expect(names(html)).toEqual(["name", "reviewHour", "timezone"]);
    expect(htmlToText(html)).toContain("Set up OrbitDiff Web");
    expect(html).toContain('aria-label="Setup steps"');
  });

  it("starts by confirming the display name, the timezone, and the daily review hour", () => {
    const html = flow();
    expect(names(html)).toEqual(["name", "reviewHour", "timezone"]);
    expect(control(html, "name")).toContain('value="Atlas Tester"');
    const text = htmlToText(html);
    for (const label of ["Display name (required)", "Timezone (required)", "Daily review hour (required)"]) {
      expect(text).toContain(label);
    }
  });

  it("lists the steps in words, with the current one marked", () => {
    const html = flow();
    const text = htmlToText(html);
    for (const step of ["Your details", "Terms and privacy", "First profile"]) expect(text).toContain(step);
    expect(html).toContain('aria-current="step"');
  });

  it("goes straight to the first profile when onboarding is already complete", () => {
    const html = flow({ onboarded: true, completedBefore: true });
    expect(names(html)).toEqual(["profile"]);
    const text = htmlToText(html);
    expect(text).toContain("Instagram username or profile link (required)");
    expect(text).toContain("atlas_studio");
  });

  it("states that automatic identity tracking is unavailable and that the app works from imported exports", () => {
    const text = htmlToText(flow({ onboarded: true }));
    expect(text).toContain("Automatic identity tracking is unavailable");
    expect(text).toContain("OrbitDiff Web works from the exports you import");
    expect(text).toContain("Adding a profile contacts nobody");
  });

  it("never asks for anything about the Instagram login", () => {
    for (const html of [flow(), flow({ onboarded: true })]) {
      for (const tag of controls(html)) expect(tag).not.toMatch(/type="password"/);
      expect(htmlToText(html)).not.toMatch(/instagram password \(|verification code \(|session \(/i);
    }
  });
});

describe("legal pages and the operator", () => {
  const saved = process.env.OPERATOR_NAME;

  afterEach(() => {
    if (saved === undefined) delete process.env.OPERATOR_NAME;
    else process.env.OPERATOR_NAME = saved;
  });

  const who = (page: ComponentType, id: string) => sectionText(renderToStaticMarkup(createElement(page)), id);

  it("name the operator on the privacy notice when one is configured", () => {
    process.env.OPERATOR_NAME = "OrbitDiff Test Operator";
    const text = who(PrivacyPage, "who");
    expect(text).toContain("This deployment is operated by OrbitDiff Test Operator.");
    expect(text).not.toContain("has not been named");
  });

  it("name the operator in the terms when one is configured", () => {
    process.env.OPERATOR_NAME = "OrbitDiff Test Operator";
    expect(who(TermsPage, "operator")).toContain("This deployment is operated by OrbitDiff Test Operator.");
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["blank", "   "],
    ["too short to be a name", "Q"],
  ])("say plainly that no operator is named and registration is closed when the name is %s", (_label, value) => {
    if (value === undefined) delete process.env.OPERATOR_NAME;
    else process.env.OPERATOR_NAME = value;
    for (const text of [who(PrivacyPage, "who"), who(TermsPage, "operator")]) {
      expect(text).toContain("The operator of this deployment has not been named yet.");
      expect(text).toContain("Registration is closed until an operator is named.");
    }
  });

  it("invent no operator, contact address, or governing law", () => {
    delete process.env.OPERATOR_NAME;
    for (const page of [PrivacyPage, TermsPage]) {
      const text = htmlToText(renderToStaticMarkup(createElement(page)));
      expect(text).not.toMatch(/governed by|governing law|jurisdiction|courts of/i);
      expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    }
  });
});

describe("every account screen", () => {
  const granted = (kind: "terms" | "privacy") => ({
    granted: true,
    version: CONSENT_VERSIONS[kind],
    recordedAt: "2026-09-30T10:00:00.000Z",
  });
  const account = {
    name: "Atlas Tester",
    timezone: "UTC",
    reviewHour: 9,
    onboarded: false,
    completedBefore: false,
    profiles: 0,
    consent: { terms: granted("terms"), privacy: granted("privacy"), marketing: null },
  };
  const returningAccount = {
    ...account,
    completedBefore: true,
    profiles: 2,
    consent: { ...account.consent, terms: { ...granted("terms"), version: "2025-01-01" } },
  };
  const screens: Array<[string, string]> = [
    ["sign-up", signUp({ ...OPEN, accessCodeRequired: true })],
    ["sign-up closed", signUp({ open: false, reason: "Registration is closed: storage is not configured.", accessCodeRequired: false, mailCaptured: false })],
    ["sign-in", render(SignInScreen, { configured: true, next: null, mailCaptured: true, notice: "confirm" })],
    ["verify waiting", render(VerifyEmailScreen, { configured: true, state: "waiting", mailCaptured: true })],
    ["verify opened", render(VerifyEmailScreen, { configured: true, state: "opened", mailCaptured: true })],
    ["verify invalid", render(VerifyEmailScreen, { configured: true, state: "invalid", mailCaptured: true })],
    ["forgot password", render(ForgotPasswordScreen, { configured: true, mailCaptured: true })],
    ["reset password", render(ResetPasswordScreen, { configured: true, token: "token", linkError: false })],
    ["reset password invalid", render(ResetPasswordScreen, { configured: true, token: null, linkError: false })],
    ["verify not configured", render(VerifyEmailScreen, { configured: false, state: "waiting", mailCaptured: false })],
    ["reset password not configured", render(ResetPasswordScreen, { configured: false, token: "token", linkError: false })],
    ["onboarding", render(OnboardingFlow, { account, timezones: TIMEZONES, versions: VERSIONS })],
    [
      "onboarding profile",
      render(OnboardingFlow, {
        account: { ...account, onboarded: true, completedBefore: true },
        timezones: TIMEZONES,
        versions: VERSIONS,
      }),
    ],
    ["onboarding returning", render(OnboardingFlow, { account: returningAccount, timezones: TIMEZONES, versions: VERSIONS })],
  ];

  it.each(screens)("%s has exactly one h1", (_name, html) => {
    expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
  });

  it.each(screens)("%s contains no U+2014 character", (_name, html) => {
    expect(html).not.toContain(EM_DASH);
  });

  it.each(screens)("%s renders no inline style attribute, which the content security policy would block", (_name, html) => {
    expect(html).not.toMatch(/\sstyle="/);
  });

  it.each(screens)("%s gives every control a name and a label", (_name, html) => {
    for (const tag of controls(html)) {
      expect(tag).toMatch(/\sname="[^"]+"/);
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      expect(id, tag).toBeTruthy();
      expect(html).toContain(`for="${id}"`);
    }
  });

  it.each(screens)("%s gives every form one submit button, where focus returns after a failed request", (_name, html) => {
    const forms = html.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    for (const form of forms) {
      expect((form.match(/<button\b[^>]*type="submit"/g) ?? []).length).toBe(1);
    }
  });

  it.each(screens)("%s never claims that tracking is automatic or happens as things change", (_name, html) => {
    expect(htmlToText(html)).not.toMatch(/tracks? (your )?followers|in real time|as changes happen|monitors? your/i);
  });
});
