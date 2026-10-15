import Link from "next/link";

import { buttonClasses } from "./button-classes";
import { cx } from "./classes";
import { paginationItems } from "./pagination-items";

export interface PaginationProps {
  /** Current page, starting at 1. */
  page: number;
  totalPages: number;
  /**
   * Address of a page. Use this in server components: every control is then a link.
   * Give either `hrefFor` or `onPageChange`.
   */
  hrefFor?: (page: number) => string;
  /** Called with the chosen page. Use this in client components. */
  onPageChange?: (page: number) => void;
  /** Names the navigation landmark, for example "Relationship pages". */
  label?: string;
  className?: string;
}

/**
 * Previous and next controls with "Page X of Y" at every width, plus numbered pages from 640px up.
 * It renders nothing when there is only one page.
 */
export function Pagination({ page, totalPages, hrefFor, onPageChange, label = "Pagination", className }: PaginationProps) {
  const total = Math.max(1, Math.floor(totalPages) || 1);
  const current = Math.min(total, Math.max(1, Math.floor(page) || 1));
  if (total <= 1) {
    return null;
  }

  const control = (target: number, text: string, options: { current?: boolean; name?: string; disabled?: boolean }) => {
    const classes = cx(
      buttonClasses({ variant: options.current ? "primary" : "secondary" }),
      "min-w-10 tabular-nums",
    );
    if (options.disabled) {
      return (
        <span aria-disabled="true" className={classes}>
          {text}
        </span>
      );
    }
    if (hrefFor) {
      return (
        <Link
          href={hrefFor(target)}
          aria-label={options.name}
          aria-current={options.current ? "page" : undefined}
          className={classes}
        >
          {text}
        </Link>
      );
    }
    return (
      <button
        type="button"
        aria-label={options.name}
        aria-current={options.current ? "page" : undefined}
        className={classes}
        onClick={onPageChange ? () => onPageChange(target) : undefined}
      >
        {text}
      </button>
    );
  };

  return (
    <nav aria-label={label} className={cx("flex flex-wrap items-center justify-between gap-3", className)}>
      {control(current - 1, "Previous", { name: "Previous page", disabled: current === 1 })}
      <ul className="hidden items-center gap-1 sm:flex">
        {paginationItems(current, total).map((item) =>
          item.type === "gap" ? (
            <li key={item.key} aria-hidden="true" className="px-1 text-muted">
              ...
            </li>
          ) : (
            <li key={item.page}>
              {control(item.page, String(item.page), { current: item.current, name: `Page ${item.page}` })}
            </li>
          ),
        )}
      </ul>
      <p className="text-sm text-muted sm:sr-only">
        Page {current} of {total}
      </p>
      {control(current + 1, "Next", { name: "Next page", disabled: current === total })}
    </nav>
  );
}
