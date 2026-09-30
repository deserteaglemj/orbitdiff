import type { ReactNode } from "react";

import { cx } from "./classes";

export interface PageHeaderProps {
  /** The page's only h1. */
  title: ReactNode;
  description?: ReactNode;
  /** Buttons for the page's main actions. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-[65ch] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface SectionHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading level. Sections directly under the page title are level 2. */
  level?: 2 | 3;
  /** Set when something refers to this heading, for example `aria-labelledby` or an anchor link. */
  id?: string;
  className?: string;
}

export function SectionHeading({ title, description, actions, level = 2, id, className }: SectionHeadingProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <Heading
          id={id}
          className={cx("font-semibold tracking-tight text-ink", level === 2 ? "text-xl" : "text-base")}
        >
          {title}
        </Heading>
        {description ? <p className="mt-1 max-w-[65ch] text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
