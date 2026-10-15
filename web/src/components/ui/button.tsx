"use client";

import type { ComponentProps, MouseEvent } from "react";

import { buttonClasses, type ButtonStyle } from "./button-classes";
import { cx } from "./classes";
import { Spinner } from "./spinner";

export interface ButtonProps extends ComponentProps<"button">, ButtonStyle {
  /**
   * Shows a spinner over the label and ignores clicks. The button stays focusable and keeps its
   * width, so focus is not lost and the layout does not move while work is in progress.
   */
  loading?: boolean;
  /** Announced while loading. */
  loadingLabel?: string;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingLabel = "Working",
  type = "button",
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cx(buttonClasses({ variant, size, fullWidth }), className)}
      onClick={handleClick}
      {...rest}
    >
      <span className={cx("inline-flex items-center gap-2", loading && "opacity-0")}>{children}</span>
      {loading ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner decorative />
          <span className="sr-only">{loadingLabel}</span>
        </span>
      ) : null}
    </button>
  );
}
