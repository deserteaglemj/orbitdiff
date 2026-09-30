import { describe, expect, it } from "vitest";

import { paginationItems } from "@/components/ui/pagination-items";

const show = (page: number, total: number) =>
  paginationItems(page, total)
    .map((item) => (item.type === "gap" ? "..." : item.current ? `[${item.page}]` : `${item.page}`))
    .join(" ");

describe("paginationItems", () => {
  it("lists every page when there are few", () => {
    expect(show(2, 5)).toBe("1 [2] 3 4 5");
  });

  it("returns a single current page when there is one page", () => {
    expect(show(1, 1)).toBe("[1]");
  });

  it("treats zero pages as one page", () => {
    expect(show(1, 0)).toBe("[1]");
  });

  it("keeps the first page, the last page, and the neighbours of the current page", () => {
    expect(show(10, 20)).toBe("1 ... 9 [10] 11 ... 20");
  });

  it("does not hide a single page behind a gap", () => {
    expect(show(3, 20)).toBe("1 2 [3] 4 ... 20");
    expect(show(18, 20)).toBe("1 ... 17 [18] 19 20");
  });

  it("clamps a page outside the range", () => {
    expect(show(99, 4)).toBe("1 2 3 [4]");
    expect(show(-3, 4)).toBe("[1] 2 3 4");
  });

  it("gives each gap a distinct key", () => {
    const keys = paginationItems(10, 20).flatMap((item) => (item.type === "gap" ? [item.key] : []));
    expect(keys).toEqual(["gap-start", "gap-end"]);
  });
});
