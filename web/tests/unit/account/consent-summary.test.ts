import { describe, expect, it } from "vitest";

import {
  buildMarketingRequest,
  describeMarketingRefusal,
  documentConsentSummary,
  marketingSummary,
} from "@/components/settings/consent-summary";

const CURRENT = "2026-09-30";
const AT = "2026-09-30T10:00:00.000Z";
const accepted = { granted: true, version: CURRENT, recordedAt: AT };

describe("documentConsentSummary", () => {
  it("says which version was accepted, when, and that it is the current one", () => {
    expect(documentConsentSummary("terms", accepted, CURRENT, "Europe/Berlin")).toEqual({
      status: "current",
      badge: "Accepted",
      tone: "ok",
      text: "You accepted version 2026-09-30 of the Terms on 30 Sep 2026, 12:00 (Europe/Berlin). It is the current version.",
    });
  });

  it("names the Privacy notice for the privacy record", () => {
    expect(documentConsentSummary("privacy", accepted, CURRENT).text).toBe(
      "You accepted version 2026-09-30 of the Privacy notice on 30 Sep 2026, 10:00 (UTC). It is the current version.",
    );
  });

  it("says the record is outdated when the accepted version is not the current one", () => {
    const summary = documentConsentSummary("terms", { ...accepted, version: "2026-01-15" }, CURRENT);
    expect(summary).toMatchObject({ status: "outdated", badge: "Outdated", tone: "warning" });
    expect(summary.text).toBe(
      "You accepted version 2026-01-15 of the Terms on 30 Sep 2026, 10:00 (UTC). The current version is 2026-09-30.",
    );
  });

  it("treats the current version with extra characters as another version", () => {
    expect(documentConsentSummary("terms", { ...accepted, version: `${CURRENT} ` }, CURRENT).status).toBe("outdated");
  });

  it("says so when an acceptance was recorded without a version", () => {
    const summary = documentConsentSummary("privacy", { ...accepted, version: "" }, CURRENT);
    expect(summary.status).toBe("outdated");
    expect(summary.text).toBe(
      "An acceptance of the Privacy notice was recorded on 30 Sep 2026, 10:00 (UTC) without a version. The current version is 2026-09-30.",
    );
  });

  it("says the acceptance was withdrawn when the newest record is not granted", () => {
    const summary = documentConsentSummary("terms", { ...accepted, granted: false }, CURRENT);
    expect(summary).toMatchObject({ status: "withdrawn", badge: "Withdrawn", tone: "warning" });
    expect(summary.text).toBe(
      "Your acceptance of the Terms was withdrawn on 30 Sep 2026, 10:00 (UTC). The record names version 2026-09-30.",
    );
  });

  it.each([
    ["the string true", "true"],
    ["the number one", 1],
    ["missing", undefined],
  ])("does not read a granted value that is %s as an acceptance", (_label, granted) => {
    const entry = { ...accepted, granted } as unknown as typeof accepted;
    expect(documentConsentSummary("terms", entry, CURRENT).status).toBe("withdrawn");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("says nothing is recorded when the record is %s", (_label, entry) => {
    expect(documentConsentSummary("privacy", entry, CURRENT)).toEqual({
      status: "missing",
      badge: "Not recorded",
      tone: "warning",
      text: "No acceptance of the Privacy notice is recorded for this account.",
    });
  });
});

describe("marketingSummary", () => {
  it("says product news is on, with the time and the version of the record", () => {
    expect(marketingSummary(accepted, "Europe/Berlin")).toEqual({
      granted: true,
      badge: "On",
      tone: "ok",
      text: "Product news is on. Recorded on 30 Sep 2026, 12:00 (Europe/Berlin), at version 2026-09-30.",
    });
  });

  it("says product news is off, with the time and the version of the record", () => {
    expect(marketingSummary({ ...accepted, granted: false })).toEqual({
      granted: false,
      badge: "Off",
      tone: "neutral",
      text: "Product news is off. Recorded on 30 Sep 2026, 10:00 (UTC), at version 2026-09-30.",
    });
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("is off when the record is %s, and says no choice is recorded", (_label, entry) => {
    expect(marketingSummary(entry)).toEqual({
      granted: false,
      badge: "Off",
      tone: "neutral",
      text: "Product news is off. No choice has been recorded.",
    });
  });

  it.each([
    ["the string true", "true"],
    ["the string on", "on"],
    ["the number one", 1],
    ["an object", {}],
  ])("is off when granted is %s: only the boolean true is a grant", (_label, granted) => {
    const entry = { ...accepted, granted } as unknown as typeof accepted;
    expect(marketingSummary(entry).granted).toBe(false);
    expect(marketingSummary(entry).badge).toBe("Off");
  });
});

describe("describeMarketingRefusal", () => {
  it("says the consent changed while the page was open when the route refuses the version", () => {
    expect(
      describeMarketingRefusal({ code: "invalid_input", fields: ["version"], message: "version is not the current version." }),
    ).toBe("The product news consent changed while this page was open. Reload this page, read it again, and choose again.");
  });

  it("keeps the route's own message for every other refusal", () => {
    expect(describeMarketingRefusal({ code: "forbidden_origin", fields: [], message: "This request came from another site." })).toBe(
      "This request came from another site.",
    );
    expect(describeMarketingRefusal({ code: "invalid_input", fields: ["granted"], message: "Send granted as true or false." })).toBe(
      "Send granted as true or false.",
    );
    expect(describeMarketingRefusal({ code: "unavailable", fields: ["version"], message: "Try again shortly." })).toBe(
      "Try again shortly.",
    );
  });
});

describe("buildMarketingRequest: what the product news toggle sends", () => {
  it("sends a grant as the boolean true with the version the page showed", () => {
    expect(buildMarketingRequest(true, CURRENT)).toEqual({ ok: true, body: { granted: true, version: CURRENT } });
  });

  it("sends a withdrawal as the boolean false, with no version", () => {
    const request = buildMarketingRequest(false, CURRENT);
    expect(request).toEqual({ ok: true, body: { granted: false } });
    expect(request.ok && Object.keys(request.body)).toEqual(["granted"]);
  });

  it("can always send a withdrawal, even when the page holds no version", () => {
    for (const version of [undefined, null, "", 7]) {
      expect(buildMarketingRequest(false, version)).toEqual({ ok: true, body: { granted: false } });
    }
  });

  it("sends nothing when the choice is missing", () => {
    expect(buildMarketingRequest(undefined, CURRENT).ok).toBe(false);
  });

  it("sends nothing when the choice is null", () => {
    expect(buildMarketingRequest(null, CURRENT).ok).toBe(false);
  });

  it("sends nothing when the choice is an empty string", () => {
    expect(buildMarketingRequest("", CURRENT).ok).toBe(false);
  });

  it.each([
    ["the string true", "true"],
    ["the string on", "on"],
    ["the string false", "false"],
    ["the number one", 1],
    ["the number zero", 0],
    ["an object", {}],
    ["an array", [true]],
  ])("sends nothing when the choice is %s: a value that is not a boolean is never coerced", (_label, choice) => {
    const request = buildMarketingRequest(choice, CURRENT);
    expect(request.ok).toBe(false);
    expect(request).not.toHaveProperty("body");
    expect(!request.ok && request.error).toBe("Choose whether product news is on or off, then save.");
  });

  it("sends no grant when the page holds no version", () => {
    expect(buildMarketingRequest(true, undefined).ok).toBe(false);
  });

  it("sends no grant when the version is empty", () => {
    expect(buildMarketingRequest(true, "").ok).toBe(false);
  });

  it.each([
    ["a number", 20260930],
    ["the boolean true", true],
    ["blank", "   "],
    ["longer than any version", "2026-09-30".repeat(7)],
  ])("sends no grant when the version is %s", (_label, version) => {
    const request = buildMarketingRequest(true, version);
    expect(request.ok).toBe(false);
    expect(request).not.toHaveProperty("body");
    expect(!request.ok && request.error).toBe(
      "This page does not hold the version of the product news consent it showed. Reload the page and try again.",
    );
  });

  it("never bundles the Terms or the Privacy notice into the request", () => {
    for (const choice of [true, false]) {
      const request = buildMarketingRequest(choice, CURRENT);
      if (!request.ok) throw new Error("expected a request");
      const keys = Object.keys(request.body);
      for (const key of keys) expect(["granted", "version"]).toContain(key);
      expect(JSON.stringify(request.body)).not.toMatch(/terms|privacy/i);
    }
  });
});
