import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClasses, type ButtonStyle } from "./button-classes";
import { cx, isExternalHref } from "./classes";

export interface LinkButtonProps extends ButtonStyle {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}

/**
 * A link that looks like a button. Use it for navigation and use Button for actions.
 * Addresses outside the app render as a plain anchor with a safe `rel`.
 */
export function LinkButton({ href, children, className, variant, size, fullWidth, ...rest }: LinkButtonProps) {
  const classes = cx(buttonClasses({ variant, size, fullWidth }), className);
  if (isExternalHref(href)) {
    return (
      <a href={href} rel="noopener noreferrer" className={classes} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  );
}
