# Try OrbitDiff with your agent

For a local coding agent that can run terminal commands. Python 3.11+, Git and pipx are prerequisites for the pinned runtime route. Named host placement is not a compatibility guarantee. The skill instructs; the runtime commands.

Paste the block below. It finishes with an offline receipt before offering live use.

```text
Role: Set up the OrbitDiff v0.1.1 offline preview for a first-time user.
Task: Complete an isolated offline demo, then explain the result.

1. Inspect existing tools and project rules. Check Python 3.11+, Git,
   pipx and orbitdiff --help. Record which executable would run. Preserve
   an existing installation; if its version or origin is uncertain,
   report that instead of treating command help as release proof.
   If a prerequisite is missing, give the platform's setup instructions
   and record the block. Install prerequisites only with user authority.

2. If OrbitDiff is absent and installation is authorized, run:
   pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.1.1
   Do not overwrite an existing runtime or upgrade it silently.

3. Run orbitdiff --help. For storage checks, choose a fresh scratch
   directory and run orbitdiff doctor --data-dir SCRATCH_PATH.
   Doctor initializes local storage; it does not test login or Instagram.
   Run orbitdiff demo. It uses synthetic accounts and a temporary database.
   Expected output: baseline stored; pending changes observed; then
   following_stopped nova_labs (200) confirmed
   following_started ember_lab (300) confirmed
   The trailing confirmation timestamp varies per run.
   A failure ends this route with the error and a concrete next step.
   Do not repeat a failing command without identifying its cause.

4. Explain the demo: baseline is silent, a change is pending until two
   accepted complete observations agree on that relationship change,
   and the resulting times are observation times, not Follow action times.
   This accelerated example proves offline execution only.
   OrbitDiff stores its history locally. The chosen AI host handles any
   output shared with it under that host's own settings.

5. Return a receipt: outcome; executable; runtime identity if verified;
   commands and results; scratch path; Pass/Fail/Unproven for install,
   offline execution and host discovery. Mark live collection, scheduling
   and notifications Unproven unless separate evidence actually exists.
   Finish here unless the user explicitly chooses the live route.

Optional live route, only after a separate opt-in:
- Read this skill's authentication and safety references when available.
  Never ask me for my Instagram password, verification codes, cookies or
  session contents. The human creates the local session in their own
  terminal. If Instaloader's CLI is absent, offer pipx install instaloader
  for human-approved installation, then show the human:
  instaloader --login MY_INSTAGRAM_USERNAME
  Credentials go directly to Instaloader, never to you.
- Ask: "Which public Instagram username do you want to track first?"
  Wait for a target-specific answer and the human's login-reference name.
  Accept @handle or an instagram.com profile URL; ignore the query string, fragment, and any trailing slash. Require a single plausible profile
  path segment. Validate and quote inputs as arguments, never shell code.
- If a target turns out to be private, stop; request a different public
  target. Do not infer access from the human's ability to view it.
- Choose the intended local data directory explicitly and retain it for
  each command. Use init only for a target not already initialized:
  orbitdiff init TARGET --login LOGIN --data-dir DATA_PATH
  Success prints nothing. A baseline is not a batch of follow events.
- Wait at least 30 minutes after every live attempt, including baseline
  and failure. This release's runtime cooldown covers successful scans
  only; do not rely on it for failed or concurrent attempts.
  Later, with authority to collect:
  orbitdiff scan TARGET --login LOGIN --data-dir DATA_PATH
  orbitdiff status TARGET --json --data-dir DATA_PATH
  orbitdiff report TARGET --format markdown --data-dir DATA_PATH
- Preserve evidence after failed or incomplete observations. Stop on
  session, challenge, rate-limit, private-target or completeness problems
  and have the human resolve the issue before another attempt.
- A provider-finished list passing the >=95% reported-count threshold is
  accepted as complete in v0.1.1; exact roster coverage is not guaranteed.
  There is no explicit collection request/time bound in this release.
- History begins at baseline; brief changes between observations can be
  missed. Read reports as facts, with motives and relationship judgments
  unknown. Status confirmed_count is a relationship count, not event count.
- Scheduling is a separate approved setup using an existing local host.
  v0.1.1 has no built-in daily alerts. Installation and a manual scan do
  not prove unattended operation or notification delivery.

Optional skill placement, only for the host and scope the user selects:
  gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --agent codex --scope project
Use gh skill install --help for other host names. Preserve existing skills.
An install pins the published skill, not this local candidate's edits.
Verify actual host discovery separately; do not claim it from copied files.
```
