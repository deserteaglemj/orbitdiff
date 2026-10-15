import { Badge, Notice } from "@/components/ui";
import type { CapacityDto } from "@/server/services/contracts";

import { capacityItems, type CapacityItem } from "./capacity";

function CapacityCard({ item }: { item: CapacityItem }) {
  return (
    <li className="min-w-0 rounded-xl border border-line bg-ground p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
        <Badge tone={item.tone}>{item.badge}</Badge>
      </div>
      <p className="mt-2 text-lg leading-7 font-semibold text-ink tabular-nums">{item.value}</p>
      <p className="mt-1 text-sm text-muted">{item.detail}</p>
      {item.facts.length > 0 ? (
        <dl className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
          {item.facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline justify-between gap-4">
              <dt className="min-w-0 text-muted">{fact.label}</dt>
              <dd className="shrink-0 text-right text-ink tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

/**
 * Global capacity as the operator reads it: each count against its cap, the
 * mail mode, whether registration is open and why not, and the last batch run.
 * Anything that is paused is named again in a notice above the readings, with
 * what it pauses. Counts and flags only: no account data is part of it.
 */
export function CapacityPanel({ capacity, now }: { capacity: CapacityDto; now: Date }) {
  const items = capacityItems(capacity, now);
  const paused = items.filter((item) => item.paused);
  return (
    <div className="grid gap-5">
      {paused.length > 0 ? (
        <Notice
          tone="info"
          title={paused.length === 1 ? "One thing is paused right now." : `${paused.length} things are paused right now.`}
        >
          <ul className="grid gap-1">
            {paused.map((item) => (
              <li key={item.key}>
                <span className="font-semibold">{item.title}:</span> {item.detail}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <CapacityCard key={item.key} item={item} />
        ))}
      </ul>
    </div>
  );
}
