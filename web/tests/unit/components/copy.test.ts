import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/legal/privacy/page";
import TermsPage from "@/app/legal/terms/page";
import LandingPage from "@/app/page";
import { IDENTITY_SOURCE, NO_APP_COLLECTION, ONLY_EXPORT_SOURCE } from "@/components/capability-copy";
import { CapabilityNotice } from "@/components/capability-notice";

import { htmlToText, renderHtml, sectionText } from "./support/render";

/**
 * The copy may not claim more than docs/web/capability-matrix.md and the code support.
 * These tests render the real pages and read the words a visitor sees.
 */

describe("htmlToText", () => {
  it("drops tags, decodes entities, and separates blocks with one space", () => {
    expect(htmlToText('<p>Other people&#x27;s <a href="/x">lists</a>.</p><p>A &amp; B</p>')).toBe(
      "Other people's lists. A & B",
    );
  });
});

describe("privacy notice: what is collected", () => {
  const collected = sectionText(renderHtml(PrivacyPage), "collected");

  it("lists the display name as required, because sign-up rejects a missing or blank one", () => {
    expect(collected).toContain("Display name Required when you sign up.");
    expect(collected).not.toContain("optional");
  });

  it("does not say that email is sent or that the address is proven to be yours", () => {
    expect(collected).not.toContain("to send the messages you ask for");
    expect(collected).not.toContain("verify that the address is yours");
  });

  it("says that the preview cannot deliver email and that account messages are stored and readable by the operator", () => {
    expect(collected).toContain("This preview cannot deliver email yet.");
    expect(collected).toContain("stored instead of sent");
    expect(collected).toContain("the operator can read them");
  });
});

describe("privacy notice: how long data is kept", () => {
  const retention = sectionText(renderHtml(PrivacyPage), "retention");

  it("does not imply that mail is delivered outside test deployments", () => {
    expect(retention).not.toContain("On test deployments");
    expect(retention).toContain("Account messages that are stored instead of sent are removed after 7 days.");
  });

  it("says how long security events are kept", () => {
    expect(retention).toContain(
      "Security events, such as a completed password reset or a refused registration, are removed after 90 days.",
    );
  });

  it("says how many sign-in sessions an account keeps and that expired ones are removed", () => {
    expect(retention).toContain("An account keeps at most 20 sign-in sessions: a new sign-in ends the oldest.");
    expect(retention).toContain("An expired session is removed.");
  });
});

describe("terms: quotas", () => {
  const quotas = sectionText(renderHtml(TermsPage), "quotas");

  it("lists the daily limits on resuming a profile and on turning product news on", () => {
    expect(quotas).toContain("5 resumes per profile per day. Pausing is never limited.");
    expect(quotas).toContain("Product news can be turned on 5 times per day. Turning it off is never limited.");
  });
});

describe("privacy notice: who can see your data", () => {
  const access = sectionText(renderHtml(PrivacyPage), "access");

  it("lists the stored account messages among what the operator can read", () => {
    expect(access).toContain("account messages that are stored instead of sent");
    expect(access).toContain("links");
  });
});

describe("capability copy", () => {
  it("limits the claim about Instagram to collection by an app", () => {
    expect(NO_APP_COLLECTION).toBe(
      "Instagram offers no authorized way for an app to collect the accounts that follow you or that you follow.",
    );
  });

  it("names the export the owner requests as the only authorized source", () => {
    expect(ONLY_EXPORT_SOURCE).toBe("The only authorized source is the export you request from Instagram yourself.");
  });

  it("joins both sentences into one statement, the limit first", () => {
    expect(IDENTITY_SOURCE).toBe(`${NO_APP_COLLECTION} ${ONLY_EXPORT_SOURCE}`);
  });
});

describe("the statement about what Instagram allows", () => {
  const surfaces: [name: string, text: string][] = [
    ["landing page", htmlToText(renderHtml(LandingPage))],
    ["terms", htmlToText(renderHtml(TermsPage))],
    ["standing notice", htmlToText(renderHtml(CapabilityNotice))],
  ];

  it.each(surfaces)("on the %s does not deny every authorized way to list the accounts", (_name, text) => {
    expect(text).not.toMatch(/no authorized way to list/);
  });

  it.each(surfaces)("on the %s is limited to collection by an app and names the export", (_name, text) => {
    expect(text).toContain(
      "Instagram offers no authorized way for an app to collect the accounts that follow you or that you follow. " +
        "The only authorized source is the export you request from Instagram yourself.",
    );
  });
});
