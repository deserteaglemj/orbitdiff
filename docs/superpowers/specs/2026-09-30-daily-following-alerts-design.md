# Daily following alerts

## Intent and scope

Configure a public following target once, collect daily through an existing agent host, and notify about newly confirmed additions. The runtime owns due checks and event truth. The host owns wakeups. Ordinary installation creates no recurring work. Personal exports retain their separate snapshot semantics.

The initial integration is a Codex heartbeat and macOS Notification Center through the existing system notification command. A generic daemon, system scheduler, cloud service, paid API, and UI redesign are outside this change. Protected app surfaces and other checkouts remain untouched. Activation needs a selected workspace, target, human-created login reference, time, timezone, host registration, and notification destination.

## Choices and costs

Use an existing heartbeat invoking an installed `orbit-os alerts run` command. A new system scheduler would create another lifecycle; a free-running process would violate the daemon boundary. Neither is necessary. The host adapter remains agent instructions using the host's supported tools, since Codex exposes no executable-registration API to this Python package.

Use native macOS notifications initially. This adds no dependency, remote destination, or dollar charge. Each host wake still consumes the user's existing agent-host allowance. The runtime does not call a model. Collection retains the existing 100-query, 10,000-account and cooperative 120-second limits. Delivery performs at most 20 native submissions per invocation, with a 10-second subprocess timeout each and three attempts for definite pre-submission failures. Uncertain submissions are held for explicit resolution. No background CPU/RAM is allocated by the runtime; transient memory and disk growth will be measured with synthetic input. Relationship history grows with observations and changes; no automatic deletion is introduced.

## State and contracts

Add tables to the existing private SQLite database. Reading status never initializes, migrates, or chmods it. A durable database UUID scopes event identity. Additive migration preserves existing evidence and can be safely repeated.

An alert job stores its UUID, target, absolute workspace and runtime reference, login/session reference, daily time, IANA timezone, host job identity, enabled/blocked state, creation cutoff, and last due window. At most one nonremoved job per target is configured in a workspace. Repeated matching setup returns that job; conflicting setup requires an explicit update while paused. One job can have independently identified subscriptions. Initial external support is only the current macOS session.

Setup is inactive. Binding a host ID records registration; enablement requires an existing complete manual observation and explicit local activation. This is a prerequisite check, not proof of authorization or live provenance. The agent must retain the actual manual receipt. Host recurrence must use the selected timezone; a timezone edit requires pausing and rebinding the host schedule.

Every local calendar date has one due window. A repeated local time uses the first occurrence; a nonexistent time moves forward to the first valid minute. Store actual instants in UTC. A wake processes only the most recent due window since activation, records a compact range/count of missed windows, and never catches up in a burst. Clock rollback does not reopen a claimed window. Resume skips paused windows. A schedule edit retains its consumed window boundary to prevent a second collection that day.

This defines runtime eligibility, not a host wake guarantee. If the host skips a DST occurrence or is unavailable, record it as missed on the next wake and apply bounded catch-up. Do not add frequent model wakeups to simulate a stronger scheduler guarantee.

Claim the window transactionally before collection. Never reclaim a crashed window for another collection. Mark abandoned claims interrupted after a bounded observation interval. Retain the existing cross-entry-point 30-minute cooldown. Extract one live runner shared by manual and scheduled scans. Fence result commits against the persisted attempt identity so a suspended older collector cannot overwrite a newer attempt.

A cooldown rejection consumes the scheduled window as skipped without a provider request. It does not block the job or imply a new failed observation. The next ordinary daily window remains eligible. Previously confirmed notifications can still be reconciled and delivered.

A subscription has its own UUID and activation event watermark. Reconcile stored `following_started` IDs above that watermark into durable delivery units transactionally, with a unique subscription/event mapping. Reconciliation runs even if the previous process crashed after confirming events. It never uses stdout and never replays preactivation events implicitly. Baselines and pending changes are silent. Matching observations confirm each relationship edge, not an identical whole roster.

Freeze each delivery unit's content and membership before submission. Stable keys include database UUID, subscription UUID, and delivery UUID. Chunk large digests without dropping events. Newly confirmed events cannot alter a unit under retry. Payloads contain only the target, observed handles, first-observed and confirmed times, and profile URLs as text. No exact follow-time or relationship judgments.

Delivery states are pending, sending, accepted, failed, uncertain, and discarded. Claim with an ownership token and bounded lease. A lease lost after possible submission becomes uncertain, not automatically resent. Definite pre-submission failure can retry on a later invocation, at most three total attempts, without collection. Idempotent transports may reuse stable keys; macOS does not provide idempotency or display/read acknowledgement. Explicit resolution can discard or retry an uncertain unit with a duplicate warning. Keep attempt receipts separate from evidence.

Use constant AppleScript with argv data, shell disabled, fixed title, and a timeout. Reject unsupported platforms before claiming submission. A zero exit is accepted by the local adapter only. No clickable-action promise. Failure diagnostics use allowlisted messages rather than exception/session text.

Pause prevents new run and delivery claims; already dispatched bounded work may finish and is shown as in flight. Removal marks only the owned local job removed and preserves all history; the agent removes the matching host job through its native tool. Resume retains queued notices and reconciles confirmations after the original subscription cutoff, with their original dates. Destination changes create a new subscription cutoff and retire the previous subscription's unsent units.

Collection failure blocks automatic collection until explicit recovery/resume, while already confirmed events can still be delivered. This avoids repeated unknown authentication or provider failures. A newly blocking failure and recovery each create one status notice. Delivery-channel failures create local warnings, never recursive failure notices. Recovery is reported once when the channel accepts delivery again.

## User and host interface

`orbit-os alerts` supplies setup, status, host binding, enable, pause, resume, update, remove, dry-run, run, deliver, resolve, and a clearly labeled synthetic notification test. All commands retain an explicit workspace. Status includes last attempt, complete observation, next due window, pending count, run receipts, delivery summaries, blocked reason, and host registration reference. Default status redacts login/session references. Dry-run performs no collection or delivery and preserves files.

`run` is a one-shot: claim at most one due collection, apply the existing evidence rules, reconcile stored confirmations, and dispatch a bounded batch. `deliver` retries only existing notifications. The executable is version/help checked during setup and its absolute identity must match on later invocation. Commands never execute a stored runtime path or profile text as code.

## Verification and completion

Use synthetic providers and injected clocks to cover silent baseline/pending/confirmation/refollow, failed observations, migration, duplicate and concurrent calls, stale workers, crash recovery, immutable digests, retry ambiguity, pause/resume/removal, DST, timezone edits, downtime, size limits, platform rejection, and secret redaction. Run the full existing checks and an installed-candidate smoke outside the checkout. Keep the original installation proof intact.

Report installation, host registration, scheduled execution, live collection, native submission, displayed/read notification, and repeated daily operation separately. Repeated daily operation needs three consecutive actual daily scheduled windows with complete collections and correct event/no-event handling. No-event windows do not prove event delivery. Missing activation inputs leave those gates Unproven while code, docs, checks, and PR proceed.
