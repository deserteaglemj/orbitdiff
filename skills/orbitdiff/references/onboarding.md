# Copy-paste prompt: set up OrbitDiff with any AI agent

Paste the block below into Claude, Codex, GitHub Copilot, Cursor, Gemini CLI, OpenCode, or any other coding agent. It walks the agent through install, verification, and your first tracked target.

```text
You are setting up OrbitDiff for me, a first-time user.

OrbitDiff is a local-first CLI that tracks confirmed changes in public
Instagram following lists. It stores a small SQLite database on this
machine. It never asks for an Instagram password or verification code, and
it refuses private profiles.

Do these steps in order:

1. Check whether I already have it:

   orbitdiff --help

   If that works, skip to step 4.

2. Install it with pipx. If pipx is missing, install pipx first with your
   package manager (for example: brew install pipx, or pipx install
   instructions for my platform), then run:

   pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.1.1

3. Prove the install works without touching Instagram:

   orbitdiff --help
   orbitdiff doctor

4. Run the offline demo. It uses synthetic accounts and no network:

   orbitdiff demo

   Confirm the output shows a baseline line, a pending line, and these
   two confirmed events (the trailing confirmation timestamp varies per
   run because it is a real date-time):

   a line starting: following_stopped nova_labs (200) confirmed
   a line starting: following_started ember_lab (300) confirmed
   If anything else fails, fix it before continuing.

5. Explain in 3 or 4 sentences what OrbitDiff does and does not do:

   Does: watch the following list of any PUBLIC Instagram account, store
   changes locally, and confirm a change only after two matching complete
   scans.
   Does not: view private profiles, send DMs, follow or unfollow anyone,
   scrape posts or stories, or upload my data anywhere.

6. Live tracking needs a one-time Instagram session file that only I can
   create. Do not ask me for my password, a login code, cookies, or any
   session text. Instead, give me exactly these commands to run myself,
   one at a time, and wait for me to confirm each one:

   a) Install Instaloader in my terminal:

      pipx install instaloader

   b) Log in once, interactively, in my own terminal. I will type my own
      username and password directly to Instaloader, never to you:

      instaloader --login MY_INSTAGRAM_USERNAME

      (Tell me to replace MY_INSTAGRAM_USERNAME with my handle. After
      login, Instaloader saves a session file on this machine and I can
      delete it whenever I want.)

7. Ask me: "Which public Instagram username do you want to track first?"
   Wait for my answer. If the name I give starts with @, strip the @. If
   I give a full profile URL instead, take only the profile-name part of
   the path: ignore the query string, fragment, and any trailing slash,
   and use the last non-empty path segment (for example
   https://www.instagram.com/someone/ becomes someone). If the value I
   gave is not a plausible public username, ask me to confirm it before
   running any live command.

8. Create the silent baseline for my target (replace TARGET with my
   answer and LOGIN with the username I logged in with in step 6):

   orbitdiff init TARGET --login LOGIN

   Baselines print nothing when they succeed.

9. Run the first comparison scan at least 30 minutes later (OrbitDiff
   enforces a 30-minute cooldown between live scans):

   orbitdiff scan TARGET --login LOGIN

10. Show me the results:

   orbitdiff status TARGET
   orbitdiff report TARGET

11. Close by offering either of these:
   - Schedule scans (a cron job or scheduled task running the scan
     command daily), with my confirmation before creating anything.
   - Install the OrbitDiff Agent Skill so you can operate it for me in
     future sessions:

     gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.1.1 --scope user

Rules for you:
- Never ask me for my Instagram password, two-factor code, cookies, or
  session file contents.
- Never run instaloader --login yourself or handle my credentials.
- If a target turns out to be private, tell me OrbitDiff cannot track it
  and ask for a different public target.
- If any command fails, show me the error and fix the cause before
  moving on. Do not skip the demo check.
- Track exactly one target until I ask for more.
```

After the final step, every later check is just:

```bash
orbitdiff scan TARGET --login LOGIN
orbitdiff report TARGET
```

Run scans at least 30 minutes apart, and treat a change as real only after two scans agree.
