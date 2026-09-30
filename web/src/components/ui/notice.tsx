import type { ReactNode } from "react";

import { cx } from "./classes";

export type NoticeTone = "info" | "warning" | "danger";

const TONES: Record<NoticeTone, { box: string; label: string; word: string }> = {
  info: { box: "border-blue/50 bg-blue-tint", label: "text-blue", word: "Note" },
  warning: { box: "border-amber/50 bg-amber-tint", label: "text-amber", word: "Warning" },
  danger: { box: "border-2 border-danger bg-danger-tint", label: "text-danger", word: "Problem" },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  /** Links or buttons shown under the text. */
  actions?: ReactNode;
  /** The word shown before the title. Defaults to Note, Warning, or Problem. */
  label?: string;
  /**
   * Set when the notice appears after the page has loaded, so it is announced:
   * danger as an alert, the other tones politely. Leave unset for a standing notice.
   */
  live?: boolean;
  className?: string;
}

/** A banner. The label word states the tone, so the meaning does not depend on colour. */
export function Notice({ tone = "info", title, children, actions, label, live = false, className }: NoticeProps) {
  const style = TONES[tone];
  const role = live ? (tone === "danger" ? "alert" : "status") : "note";
  return (
    <div role={role} className={cx("rounded-xl border px-4 py-4 sm:px-5", style.box, className)}>
      <p className="text-sm">
        <span className={cx("font-semibold", style.label)}>{label ?? style.word}: </span>
        <span className="font-semibold text-ink">{title}</span>
      </p>
      {children ? <div className="mt-1 text-sm text-ink">{children}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}
