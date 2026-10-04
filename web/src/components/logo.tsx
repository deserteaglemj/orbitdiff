import Link from "next/link";

import { cx } from "./ui/classes";

/** The OrbitDiff mark. Same shapes as public/orbitdiff-mark.svg, inlined so it never shifts layout. */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", className)}
    >
      <rect width="128" height="128" rx="28" fill="var(--color-ground)" />
      <circle cx="64" cy="64" r="34" fill="none" stroke="var(--color-blue)" strokeWidth="10" />
      <circle cx="91" cy="47" r="9" fill="var(--color-amber)" />
      <path
        d="M31 81c12 10 31 13 49 4"
        fill="none"
        stroke="var(--color-green)"
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark next to the word OrbitDiff, linking to `href`. The accessible name is the product name. */
export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="OrbitDiff Web home"
      className={cx("inline-flex min-h-10 items-center gap-2 rounded-lg text-ink", className)}
    >
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">OrbitDiff</span>
      <span className="text-lg font-normal text-muted">Web</span>
    </Link>
  );
}
