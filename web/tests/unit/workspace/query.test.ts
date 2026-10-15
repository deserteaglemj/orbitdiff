import { describe, expect, it } from "vitest";

import { buildHref, firstValue, readChoice, readPage, readSearch } from "@/components/dashboard/query";

describe("firstValue", () => {
  it("takes the first of a repeated parameter and an empty string for a missing one", () => {
    expect(firstValue("a")).toBe("a");
    expect(firstValue(["a", "b"])).toBe("a");
    expect(firstValue(undefined)).toBe("");
    expect(firstValue([])).toBe("");
  });
});

describe("readPage", () => {
  it("reads a positive whole number", () => {
    expect(readPage("3")).toBe(3);
    expect(readPage(["2", "9"])).toBe(2);
  });

  it("falls back to the first page for anything else", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "abc", "1e3", "999999999999"]) {
      expect(readPage(value), String(value)).toBe(1);
    }
  });
});

describe("readChoice", () => {
  const allowed = ["mutual", "unknown"] as const;

  it("accepts only a listed value", () => {
    expect(readChoice("mutual", allowed)).toBe("mutual");
    expect(readChoice("everyone", allowed)).toBeNull();
    expect(readChoice(undefined, allowed)).toBeNull();
    expect(readChoice("", allowed)).toBeNull();
  });
});

describe("readSearch", () => {
  it("trims the text and keeps at most 100 characters, the bound of the list services", () => {
    expect(readSearch("  Nova  ")).toBe("Nova");
    expect(readSearch("x".repeat(150))).toHaveLength(100);
    expect(readSearch(undefined)).toBe("");
  });
});

describe("buildHref", () => {
  it("leaves out empty values and the first page", () => {
    expect(buildHref("/dashboard", { q: "", kind: null, status: undefined, page: 1 })).toBe("/dashboard");
  });

  it("encodes the values that are set, in the order given", () => {
    expect(buildHref("/dashboard", { q: "nova labs", kind: "review", page: 2 })).toBe(
      "/dashboard?q=nova+labs&kind=review&page=2",
    );
  });

  it("appends a fragment", () => {
    expect(buildHref("/dashboard", { page: 2 }, "activity")).toBe("/dashboard?page=2#activity");
    expect(buildHref("/dashboard", {}, "activity")).toBe("/dashboard#activity");
  });
});
