/** The query of a page as Next.js 16 hands it over: a promise of strings and string lists. */
export type PageQuery = Promise<Record<string, string | string[] | undefined>>;

/** A query value when it was given exactly once, as a string of bounded length. Null otherwise. */
export function single(value: string | string[] | undefined, maxLength = 2_048): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}
