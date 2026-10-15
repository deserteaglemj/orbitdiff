import { Badge, buttonClasses, Notice, SectionHeading, StatTile } from "@/components/ui";
import { formatCount } from "@/components/ui/format";
import type { MeDto } from "@/server/services/contracts";

import { formatBytes, quotaState, type QuotaState } from "./format";

/** The route that sends everything stored for the signed-in account as one JSON file. */
const EXPORT_PATH = "/api/account/export";

function QuotaHint({ state, children }: { state: QuotaState; children: string }) {
  return (
    <>
      <Badge tone={state.tone}>{state.label}</Badge>
      <span className="mt-1 block">{children}</span>
    </>
  );
}

/**
 * The download of everything stored for the account, and the usage against
 * each quota. A reached quota is shown as a paused state with what it pauses
 * and what ends the pause. Nothing here leads to a paid tier: there is none.
 */
export function DataSection({ usage }: { usage: MeDto["usage"] }) {
  const profiles = quotaState(usage.profiles, usage.profilesLimit);
  const imports = quotaState(usage.importsToday, usage.importsPerDayLimit);
  const storage = quotaState(usage.rosterBytes, usage.rosterBytesLimit);
  const paused = [
    profiles.level === "reached"
      ? `You have ${formatCount(usage.profiles)} of ${formatCount(usage.profilesLimit)} profiles. You cannot add another profile until you remove one.`
      : null,
    imports.level === "reached"
      ? `You have used all ${formatCount(usage.importsPerDayLimit)} imports for today. Imports are paused until the next UTC day.`
      : null,
    storage.level === "reached"
      ? `Your stored usernames have reached ${formatBytes(usage.rosterBytesLimit)}. Imports are paused until you remove a profile to make room.`
      : null,
  ].filter((line): line is string => line !== null);

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <SectionHeading level={3} title="Download your data" />
        <div className="grid max-w-[65ch] gap-3 text-sm text-ink">
          <p>
            The download is one JSON file with everything OrbitDiff Web stores for your account: your account details
            and settings, the times, network addresses, and browsers of your sign-ins, your consent records, your
            profiles, every export you imported, the differences calculated from those exports, your activity,
            background jobs, and usage counters. It does not contain your password or anything that could sign
            someone in.
          </p>
          <p>
            The file holds other people&apos;s Instagram usernames: the accounts that follow you and the accounts you
            follow, as they appeared in the exports you imported. Keep it somewhere private and do not pass it on.
          </p>
        </div>
        <div>
          <a href={EXPORT_PATH} download className={buttonClasses({ variant: "secondary" })}>
            Download my data (JSON)
          </a>
        </div>
      </div>

      <div className="grid gap-4 border-t border-line pt-6">
        <SectionHeading
          level={3}
          title="Usage against your quotas"
          description="OrbitDiff Web is a free preview with fixed quotas. When one is reached, the action pauses and nothing else changes."
        />
        {paused.length > 0 ? (
          <Notice tone="info" title={paused.length === 1 ? "One quota is reached." : `${paused.length} quotas are reached.`}>
            <ul className="grid gap-1">
              {paused.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            tone="ground"
            label="Profiles"
            value={`${formatCount(usage.profiles)} of ${formatCount(usage.profilesLimit)}`}
            hint={<QuotaHint state={profiles}>Profiles on this account.</QuotaHint>}
          />
          <StatTile
            tone="ground"
            label="Imports today"
            value={`${formatCount(usage.importsToday)} of ${formatCount(usage.importsPerDayLimit)}`}
            hint={<QuotaHint state={imports}>Counted per UTC day.</QuotaHint>}
          />
          <StatTile
            tone="ground"
            label="Stored usernames"
            value={`${formatBytes(usage.rosterBytes)} of ${formatBytes(usage.rosterBytesLimit)}`}
            hint={<QuotaHint state={storage}>The size of the lists in your stored exports.</QuotaHint>}
          />
        </div>
      </div>
    </div>
  );
}
