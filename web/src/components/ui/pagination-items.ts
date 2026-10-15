export type PageItem =
  | { type: "page"; page: number; current: boolean }
  | { type: "gap"; key: "gap-start" | "gap-end" };

/**
 * The entries of a pagination control: the first page, the last page, the current page with one
 * neighbour on each side, and a gap marker wherever two or more pages are left out.
 */
export function paginationItems(page: number, totalPages: number): PageItem[] {
  const total = Math.max(1, Math.floor(totalPages) || 1);
  const current = Math.min(total, Math.max(1, Math.floor(page) || 1));

  const shown = new Set<number>([1, total, current - 1, current, current + 1]);
  // A gap that would hide exactly one page shows that page instead.
  if (current - 1 === 3) shown.add(2);
  if (current + 1 === total - 2) shown.add(total - 1);

  const pages = [...shown].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);

  const items: PageItem[] = [];
  let previous = 0;
  for (const n of pages) {
    if (n - previous > 1) {
      items.push({ type: "gap", key: n <= current ? "gap-start" : "gap-end" });
    }
    items.push({ type: "page", page: n, current: n === current });
    previous = n;
  }
  return items;
}
