import type { ReactNode } from "react";

import { cx } from "./classes";

export interface EmptyStateProps {
  title: ReactNode;
  /** Say why it is empty and how to fill it. */
  description?: ReactNode;
  /** One button or link that starts filling it. */
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

export function EmptyState({ title, description, action, headingLevel = 3, className }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div className={cx("rounded-xl border border-dashed border-edge px-5 py-10 text-center", className)}>
      <Heading className="text-base font-semibold text-ink">{title}</Heading>
      {description ? <p className="mx-auto mt-2 max-w-prose text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
