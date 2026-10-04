import type { ComparisonRecord } from "@/server/services/contracts";

/**
 * What "no export observation" means depends on whether a comparison could run.
 * An addition is checked only when the earlier export's list is complete, and a
 * removal only when the later export's list is complete. Zero observations with
 * no check is unknown, and is never worded as "no difference". Pure functions,
 * shared by the activity feed and the Changes section.
 */

/** `none`: nothing could be checked. `partial`: some sides could. `full`: every side of every pair could. */
export type ComparisonExtent = "none" | "partial" | "full";

const SIDES = [
  { direction: "followers", side: "added", words: "additions to followers" },
  { direction: "followers", side: "removed", words: "removals from followers" },
  { direction: "following", side: "added", words: "additions to following" },
  { direction: "following", side: "removed", words: "removals from following" },
] as const;

export function comparisonExtent(comparison: ComparisonRecord): ComparisonExtent {
  const counts = SIDES.map(({ direction, side }) => comparison[direction]?.[side] ?? 0);
  if (counts.every((count) => count <= 0)) return "none";
  if (comparison.pairs > 0 && counts.every((count) => count >= comparison.pairs)) return "full";
  return "partial";
}

/** The sides that were checked in at least one pair, in words, joined for a sentence. */
export function checkedSides(comparison: ComparisonRecord): string {
  const checked = SIDES.filter(({ direction, side }) => (comparison[direction]?.[side] ?? 0) > 0).map(
    ({ words }) => words,
  );
  if (checked.length <= 1) return checked.join("");
  return `${checked.slice(0, -1).join(", ")} and ${checked[checked.length - 1]}`;
}

export const NOTHING_COMPARED = "Nothing could be compared";

/** Why nothing could be compared, after "Nothing could be compared between A and B." */
export const NOTHING_COMPARED_REASON =
  "An addition is checked only when the earlier export's list is complete, and a removal only when the later " +
  "export's list is complete. Neither was, so whether anything differs is unknown.";

/** Appended to "No differences were observed ..." when only part of the lists could be compared. */
export function partlyCompared(comparison: ComparisonRecord): string {
  return ` in what could be compared: ${checkedSides(comparison)}. The rest could not be compared, so whether it differs is unknown.`;
}
