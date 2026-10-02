# Inspect following history with your agent

Ask a local coding agent to explain stored public following changes using handles, event types and observation times. Start with the [offline setup prompt](../../prompt.md). The skill supplies instructions; a verified runtime executes them.

The synthetic CLI demo reports a baseline, pending observation and confirmed changes for nova_labs and ember_lab. The separate illustrated story uses atlas_studio and pixel_forge with fixed fictional dates. Neither is live data.

## Inspect an existing authorized workspace

After the user chooses the intended existing data directory, these network-free commands read stored evidence and may initialize local storage:

```bash
orbitdiff status atlas_studio --json --data-dir DATA_PATH
orbitdiff report atlas_studio --format markdown --data-dir DATA_PATH
orbitdiff report atlas_studio --format json --data-dir DATA_PATH
```

Replace the synthetic handle only with a user-selected target, and use the same data path. Status confirmed_count is the number of confirmed-present relationships, not event count. Reports contain first_seen_at and confirmed_at; the [timestamp guide](observation-times.md) explains their limits. An empty report says no confirmed changes in stored history, not that nothing happened on Instagram.

For an agent explanation: "Summarize this stored report as observed facts. Include handle, event type, first-observed and confirmed times. Mark missing evidence and unknown motives. Separate pending and failed checks from confirmed events." Review your host's settings before sharing output; local storage does not imply local model processing.

## Eligible automation

v0.1.1 has no built-in daemon, scheduler lifecycle or daily notification command. [Scheduling guidance](../../../skills/orbitdiff/references/scheduling.md) describes an existing local host after a separately authorized successful manual workflow. The selected machine/host must be available. Registration and an actual unattended invocation need their own evidence.

There is no explicit collection request/time bound or durable concurrent reservation in this release. Operationally wait 30 minutes after every attempt and avoid parallel collection. Resolve session/challenge/rate-limit/private/incomplete blocks before another attempt. No scheduler is installed or activated by these instructions.

**Try the offline demo with your agent** before choosing live setup. [Who did they follow?](who-did-they-follow.md) gives the example; the [claim ledger](../claim-ledger.md) states what this release supports.
