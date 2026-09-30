import type { ReactNode } from "react";

import { cx } from "./classes";

/*
 * Table primitives with one responsive pattern: from 640px up it is an ordinary table; below that
 * every row becomes a block and every cell shows its column name (the `label` prop), so the page
 * never scrolls sideways at 360px. The rules live under `.od-table` in globals.css. The explicit
 * ARIA roles keep table semantics where `display: block` would otherwise remove them.
 */

type Align = "left" | "right";

const ALIGN: Record<Align, string> = { left: "text-left", right: "sm:text-right" };

export interface DataTableProps {
  /** Names the table. Required. Hide it visually with `captionHidden` when a heading already names it. */
  caption: ReactNode;
  captionHidden?: boolean;
  children: ReactNode;
  className?: string;
}

export function DataTable({ caption, captionHidden = false, children, className }: DataTableProps) {
  return (
    <table role="table" className={cx("od-table w-full border-collapse text-sm", className)}>
      <caption className={captionHidden ? "sr-only" : "pb-3 text-left text-sm text-muted"}>{caption}</caption>
      {children}
    </table>
  );
}

/** The header row. Its children are DataTableHeaderCell elements. */
export function DataTableHead({ children }: { children: ReactNode }) {
  return (
    <thead role="rowgroup">
      <tr role="row" className="border-b border-line">
        {children}
      </tr>
    </thead>
  );
}

export function DataTableHeaderCell({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: Align;
  className?: string;
}) {
  return (
    <th
      role="columnheader"
      scope="col"
      className={cx("px-3 py-2 text-xs font-semibold text-muted first:pl-0 last:pr-0", ALIGN[align], className)}
    >
      {children}
    </th>
  );
}

export function DataTableBody({ children }: { children: ReactNode }) {
  return (
    <tbody role="rowgroup" className="divide-y divide-line">
      {children}
    </tbody>
  );
}

export function DataTableRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr role="row" className={className}>
      {children}
    </tr>
  );
}

export interface DataTableCellProps {
  /** The column name. Shown next to the value below 640px. Required. */
  label: string;
  children: ReactNode;
  /** Render as the row header (the cell that identifies the row). */
  rowHeader?: boolean;
  align?: Align;
  className?: string;
}

export function DataTableCell({ label, children, rowHeader = false, align = "left", className }: DataTableCellProps) {
  const classes = cx("min-w-0 align-top text-ink sm:px-3 sm:py-2.5 sm:first:pl-0 sm:last:pr-0", ALIGN[align], className);
  // The inner element keeps long usernames and digests inside the cell.
  const content = <span className="min-w-0 break-words">{children}</span>;
  if (rowHeader) {
    return (
      <th role="rowheader" scope="row" data-label={label} className={cx(classes, "font-medium")}>
        {content}
      </th>
    );
  }
  return (
    <td role="cell" data-label={label} className={classes}>
      {content}
    </td>
  );
}
