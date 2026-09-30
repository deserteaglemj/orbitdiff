import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClasses, cx } from "@/components/ui";

/**
 * A search and filter form that writes its fields into the address of the
 * page (a GET form). It works without scripts; with them the page below is
 * replaced in place and the scroll position is kept. `fixed` holds parameters
 * of the host page that must survive, for example the open section.
 *
 * Give it a `key` made of the current filter values, so the fields show the
 * values of the address after a link changed them.
 */
export function FilterForm({
  action,
  fixed = {},
  label,
  filtered,
  clearHref,
  submitLabel = "Apply filters",
  children,
  className,
}: {
  /** Path of the page. */
  action: string;
  fixed?: Record<string, string>;
  /** Names the form for assistive technology, for example "Filter activity". */
  label: string;
  /** True when a filter or search text is set, which shows the link that clears them. */
  filtered: boolean;
  clearHref: string;
  /** What the submit button says. */
  submitLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Form action={action} scroll={false} role="search" aria-label={label} className={cx("grid gap-4", className)}>
      {Object.entries(fixed).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClasses({ variant: "secondary" })}>
          {submitLabel}
        </button>
        {filtered ? (
          <Link href={clearHref} scroll={false} className="od-link inline-block py-2 text-sm">
            Clear search and filters
          </Link>
        ) : null}
      </div>
    </Form>
  );
}
