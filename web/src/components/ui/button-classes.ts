import { cx } from "./classes";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "md" | "lg";

export interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-lg text-center font-semibold " +
  "whitespace-nowrap select-none transition-colors duration-150 active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-50 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

/** Text on an accent fill is always the ground colour. Ink on blue, amber, or green fails contrast. */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-blue text-ground hover:bg-blue-bright",
  secondary: "border border-edge text-ink hover:bg-raised",
  quiet: "text-ink hover:bg-raised",
  danger: "bg-danger text-ground hover:bg-danger/85",
};

/** Both sizes meet the 40px minimum touch height. */
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

/** Shared by Button and LinkButton so a link that looks like a button matches a real one. */
export function buttonClasses({ variant = "secondary", size = "md", fullWidth = false }: ButtonStyle = {}): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full");
}
