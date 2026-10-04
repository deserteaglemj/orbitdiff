/**
 * Reading filters from the address of a page, and writing them back into
 * links. A value the page does not know is ignored, never an error: the
 * address is typed by people and copied between accounts.
 */
export type QueryValue = string | string[] | undefined;
export type PageQuery = Record<string, QueryValue>;

/** Longest search text the list services accept (SEARCH_MAX in the services). */
export const SEARCH_LENGTH = 100;
const PAGE_MAX = 100_000;

export function firstValue(value: QueryValue): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** A page number from 1 up. Anything else is the first page. */
export function readPage(value: QueryValue): number {
  const text = firstValue(value);
  if (!/^[0-9]{1,6}$/.test(text)) return 1;
  const page = Number(text);
  return page >= 1 && page <= PAGE_MAX ? page : 1;
}

/** The value when it is one of the allowed ones, otherwise null. */
export function readChoice<T extends string>(value: QueryValue, allowed: readonly T[]): T | null {
  const text = firstValue(value);
  return allowed.includes(text as T) ? (text as T) : null;
}

/** Trimmed search text, cut to the length the services accept. */
export function readSearch(value: QueryValue): string {
  return firstValue(value).trim().slice(0, SEARCH_LENGTH);
}

/** A link to `path` with the parameters that are set. Empty values and page 1 are left out. */
export function buildHref(
  path: string,
  parameters: Record<string, string | number | null | undefined>,
  fragment?: string,
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value === null || value === undefined || value === "") continue;
    if (name === "page" && Number(value) <= 1) continue;
    search.set(name, String(value));
  }
  const query = search.toString();
  return `${path}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
}
