import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio, resolveTokens } from "./support/color";

const cssPath = fileURLToPath(new URL("../../../src/app/globals.css", import.meta.url));
const tokens = resolveTokens(readFileSync(cssPath, "utf8"));

/** Normal-size text needs 4.5:1 (WCAG 1.4.3). */
const TEXT_PAIRS: [text: string, background: string][] = [
  ["ink", "ground"],
  ["ink", "surface"],
  ["ink", "raised"],
  ["ink", "blue-tint"],
  ["ink", "amber-tint"],
  ["ink", "green-tint"],
  ["ink", "danger-tint"],
  ["muted", "ground"],
  ["muted", "surface"],
  ["muted", "raised"],
  ["blue", "ground"],
  ["blue", "surface"],
  ["blue", "raised"],
  ["blue", "blue-tint"],
  ["blue-bright", "ground"],
  ["blue-bright", "surface"],
  ["blue-bright", "raised"],
  ["amber", "ground"],
  ["amber", "surface"],
  ["amber", "raised"],
  ["amber", "amber-tint"],
  ["green", "ground"],
  ["green", "surface"],
  ["green", "raised"],
  ["green", "green-tint"],
  ["danger", "ground"],
  ["danger", "surface"],
  ["danger", "raised"],
  ["danger", "danger-tint"],
  // Text on the accent fills is always the ground colour.
  ["ground", "blue"],
  ["ground", "blue-bright"],
  ["ground", "amber"],
  ["ground", "green"],
  ["ground", "danger"],
  ["ground", "ink"],
];

/**
 * Control boundaries and focus indicators need 3:1 (WCAG 1.4.11).
 * The focus ring is ink with a 2px offset, so it always sits on a page background (ground, surface,
 * or raised) and never directly against an accent fill. Ink on blue is 2.43:1 and must not be used
 * as a ring without that gap.
 */
const NON_TEXT_PAIRS: [shape: string, background: string][] = [
  ["edge", "ground"],
  ["edge", "surface"],
  ["edge", "raised"],
  ["ink", "ground"],
  ["ink", "surface"],
  ["ink", "raised"],
  ["blue", "ground"],
  ["blue", "surface"],
  ["danger", "ground"],
  ["danger", "surface"],
];

describe("design tokens in globals.css", () => {
  it("uses exactly the five OrbitDiff brand colours as its base", () => {
    expect(tokens.ground).toBe("#111827");
    expect(tokens.ink).toBe("#f8fafc");
    expect(tokens.blue).toBe("#60a5fa");
    expect(tokens.amber).toBe("#fbbf24");
    expect(tokens.green).toBe("#34d399");
  });

  it("keeps the colour set small", () => {
    expect(Object.keys(tokens).length).toBeLessThanOrEqual(16);
  });

  it.each(TEXT_PAIRS)("text %s on %s meets 4.5:1", (text, background) => {
    expect(tokens[text], `token ${text}`).toBeDefined();
    expect(tokens[background], `token ${background}`).toBeDefined();
    expect(contrastRatio(tokens[text], tokens[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)("non-text %s on %s meets 3:1", (shape, background) => {
    expect(tokens[shape], `token ${shape}`).toBeDefined();
    expect(tokens[background], `token ${background}`).toBeDefined();
    expect(contrastRatio(tokens[shape], tokens[background])).toBeGreaterThanOrEqual(3);
  });
});
