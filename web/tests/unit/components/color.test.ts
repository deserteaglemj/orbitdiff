import { describe, expect, it } from "vitest";

import { contrastRatio, mixHex, resolveTokens } from "./support/color";

describe("mixHex", () => {
  it("returns the first colour at weight 1 and the second at weight 0", () => {
    expect(mixHex("#60a5fa", "#111827", 1)).toBe("#60a5fa");
    expect(mixHex("#60a5fa", "#111827", 0)).toBe("#111827");
  });

  it("interpolates each sRGB channel like color-mix(in srgb)", () => {
    expect(mixHex("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mixHex("#f8fafc", "#111827", 0.06)).toBe("#1f2634");
  });
});

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for equal colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#111827", "#111827")).toBe(1);
  });

  it("does not depend on argument order", () => {
    expect(contrastRatio("#f8fafc", "#111827")).toBeCloseTo(contrastRatio("#111827", "#f8fafc"), 10);
  });

  it("matches the WCAG value for near-white on navy", () => {
    expect(contrastRatio("#f8fafc", "#111827")).toBeCloseTo(16.96, 1);
  });
});

describe("resolveTokens", () => {
  it("reads hex tokens, aliases, and color-mix expressions from a theme block", () => {
    const css = `
      @theme {
        --color-*: initial;
        --color-ground: #111827;
        --color-ink: #f8fafc;
        --color-surface: color-mix(in srgb, var(--color-ink) 6%, var(--color-ground));
        --color-alias: var(--color-surface);
        --font-sans: ui-sans-serif, system-ui, sans-serif;
      }
    `;
    expect(resolveTokens(css)).toEqual({
      ground: "#111827",
      ink: "#f8fafc",
      surface: "#1f2634",
      alias: "#1f2634",
    });
  });

  it("throws on a colour value it cannot evaluate", () => {
    expect(() => resolveTokens("@theme { --color-x: rgb(1 2 3); }")).toThrow(/--color-x/);
  });
});
