import Link from "next/link";

import { Badge, Card, LinkButton, Notice, Sparkline, StatGrid, StatTile } from "@/components/ui";

import type { ProfileCardModel } from "./card-model";

/** Label and value pairs. The value wraps under the label on a narrow screen. */
export function FactList({ facts, className }: { facts: Array<{ label: string; value: string }>; className?: string }) {
  return (
    <dl className={className}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-line py-2 text-sm first:border-t-0"
        >
          <dt className="text-muted">{fact.label}</dt>
          <dd className="min-w-0 text-ink tabular-nums">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One profile on the dashboard. A failure is shown in its own notice next to
 * the numbers of the last successful result, which stay as they are. A count
 * the coverage does not support is "Unknown". An old or undated export is
 * marked stale whatever its coverage.
 */
export function ProfileCard({ card, primaryImport }: { card: ProfileCardModel; primaryImport: boolean }) {
  return (
    <Card as="article" className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-lg font-semibold break-all text-ink">
            <Link href={card.profileHref} translate="no" className="od-link inline-block py-1">
              {card.handle}
            </Link>
          </h3>
          <p className="text-sm text-muted">{card.sourceLine}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {card.badges.map((badge) => (
            <Badge key={badge.text} tone={badge.tone}>
              {badge.text}
            </Badge>
          ))}
          {card.processing ? <Badge tone="info">{card.processing.title}</Badge> : null}
          {card.paused ? <Badge tone="neutral">Paused</Badge> : null}
        </div>
      </header>

      <div className="grid gap-1 text-sm text-ink">
        {card.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>

      {card.failure ? (
        <Notice tone="danger" title={card.failure.title}>
          <p>{card.failure.failed}</p>
          <p className="mt-1">{card.failure.lastSuccess}</p>
        </Notice>
      ) : null}
      {card.processing ? (
        <Notice tone="info" label="Processing" title={card.processing.title}>
          <p>{card.processing.detail}</p>
        </Notice>
      ) : null}
      {card.paused ? (
        <Notice tone="info" label="Paused" title={card.paused.title}>
          <p>{card.paused.detail}</p>
        </Notice>
      ) : null}

      <StatGrid columns={2}>
        {card.stats.map((stat) => (
          <StatTile key={stat.key} label={stat.label} value={stat.value} tone="ground" />
        ))}
      </StatGrid>

      {card.trend ? (
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{card.trend.label} across your dated exports</p>
          <Sparkline points={card.trend.points} showSummary className="mt-2" />
          <ul className="mt-2 grid gap-1 text-sm text-ink">
            {card.netChanges.map((change) => (
              <li key={change.label}>
                <span className="text-muted">{change.label}: </span>
                {change.text}
              </li>
            ))}
          </ul>
        </div>
      ) : card.hasImport ? (
        <p className="text-sm text-muted">
          A count trend appears once two dated exports have a direction you declared complete.
        </p>
      ) : null}

      <FactList
        facts={[...(card.coverage ? [{ label: "Coverage", value: card.coverage }] : []), ...card.facts]}
      />

      <div className="mt-auto flex flex-wrap gap-3">
        <LinkButton
          href={card.importHref}
          variant={primaryImport ? "primary" : "secondary"}
          aria-label={`Import export for ${card.handle}`}
        >
          Import export
        </LinkButton>
        <LinkButton href={card.profileHref} variant="secondary" aria-label={`Open profile ${card.handle}`}>
          Open profile
        </LinkButton>
      </div>
    </Card>
  );
}
