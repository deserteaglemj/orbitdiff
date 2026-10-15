import { useId, type ReactNode } from "react";

import { cx } from "./classes";

export type CardTone = "surface" | "raised" | "ground" | "blue";

/** Fill and border per tone. Use the prop: a background class in `className` would not reliably win. */
const CARD_TONES: Record<CardTone, string> = {
  surface: "border-line bg-surface",
  raised: "border-line bg-raised",
  ground: "border-line bg-ground",
  blue: "border-blue/50 bg-blue-tint",
};

export interface CardProps {
  children: ReactNode;
  /** Surface is the default raised card. Blue is for one highlighted card in a group. */
  tone?: CardTone;
  /** The element to render. Use "section" or "article" only together with a heading inside. */
  as?: "div" | "section" | "article" | "li";
  /** Set to false when the content brings its own padding (for example a table). */
  padded?: boolean;
  className?: string;
}

/** A raised surface. Use it when grouping communicates hierarchy, not for every block. */
export function Card({ children, tone = "surface", as: Tag = "div", padded = true, className }: CardProps) {
  return <Tag className={cx("rounded-xl border", CARD_TONES[tone], padded && "p-5 sm:p-6", className)}>{children}</Tag>;
}

export interface PanelProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or badges shown at the end of the header. */
  actions?: ReactNode;
  children: ReactNode;
  /** Heading level of the title. Keep the page outline in order. */
  headingLevel?: 2 | 3;
  padded?: boolean;
  className?: string;
}

/** A Card with a titled header. It is a labelled region, so the title names it for assistive technology. */
export function Panel({ title, description, actions, children, headingLevel = 2, padded = true, className }: PanelProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby={headingId} className={cx("rounded-xl border border-line bg-surface", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <Heading id={headingId} className="text-base font-semibold text-ink">
            {title}
          </Heading>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cx(padded && "p-5 sm:p-6")}>{children}</div>
    </section>
  );
}
