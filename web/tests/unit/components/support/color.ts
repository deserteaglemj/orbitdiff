/**
 * Colour arithmetic for the design-token tests.
 * Mixing follows CSS color-mix(in srgb, A p%, B): a linear blend of the gamma-encoded channels.
 * Contrast follows the WCAG 2 relative luminance formula.
 */

type Rgb = [number, number, number];

const HEX = /^#[0-9a-f]{6}$/;

function parseHex(hex: string): Rgb {
  const value = hex.toLowerCase();
  if (!HEX.test(value)) {
    throw new Error(`not a six digit hex colour: ${hex}`);
  }
  return [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16)) as Rgb;
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** `weightA` of `a` and the rest of `b`, channel by channel in sRGB. */
export function mixHex(a: string, b: string, weightA: number): string {
  const first = parseHex(a);
  const second = parseHex(b);
  return toHex(first.map((channel, i) => channel * weightA + second[i] * (1 - weightA)) as Rgb);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const DECLARATION = /--color-([a-z0-9-]+)\s*:\s*([^;]+);/g;
const ALIAS = /^var\(--color-([a-z0-9-]+)\)$/;
const MIX = /^color-mix\(in srgb,\s*var\(--color-([a-z0-9-]+)\)\s+(\d+(?:\.\d+)?)%,\s*var\(--color-([a-z0-9-]+)\)\)$/;

/**
 * Reads every `--color-<name>` declaration from a stylesheet and evaluates it to a hex colour.
 * Supports hex literals, `var(--color-x)` aliases, and `color-mix(in srgb, var(--color-a) p%, var(--color-b))`.
 */
export function resolveTokens(css: string): Record<string, string> {
  const raw = new Map<string, string>();
  for (const match of css.matchAll(DECLARATION)) {
    const value = match[2].trim();
    if (value !== "initial") {
      raw.set(match[1], value);
    }
  }

  const resolved: Record<string, string> = {};
  const resolve = (name: string, trail: string[]): string => {
    if (resolved[name]) {
      return resolved[name];
    }
    const value = raw.get(name);
    if (value === undefined || trail.includes(name)) {
      throw new Error(`cannot resolve --color-${name}`);
    }
    const next = [...trail, name];
    const alias = ALIAS.exec(value);
    const mix = MIX.exec(value);
    if (HEX.test(value.toLowerCase())) {
      resolved[name] = value.toLowerCase();
    } else if (alias) {
      resolved[name] = resolve(alias[1], next);
    } else if (mix) {
      resolved[name] = mixHex(resolve(mix[1], next), resolve(mix[3], next), Number(mix[2]) / 100);
    } else {
      throw new Error(`cannot evaluate --color-${name}: ${value}`);
    }
    return resolved[name];
  };

  for (const name of raw.keys()) {
    resolve(name, []);
  }
  return resolved;
}
