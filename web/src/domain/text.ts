/**
 * Python measures `len(str)` in code points. JavaScript's `length` counts
 * UTF-16 code units, so an astral character would count twice.
 */
export function codePointLength(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
    }
    count += 1;
  }
  return count;
}

/** True when the text has more than `limit` code points, without scanning long inputs. */
export function exceedsCodePoints(text: string, limit: number): boolean {
  if (text.length <= limit) {
    return false;
  }
  if (text.length > limit * 2) {
    return true;
  }
  return codePointLength(text) > limit;
}
