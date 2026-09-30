# Human-operated local login

Personal export imports, reports, demos, and app launch need no Instagram login.

Live public following collection uses an existing local Instaloader saved session. If it is missing or rejected, give the human this command to run themselves in their own terminal:

```bash
orbit-os login LOGIN_USERNAME
```

The package includes the login dependency. No separate Instaloader installation is needed. The human enters credentials directly into that local tool, never into agent chat. The command refuses noninteractive agent pipes.

The agent may use the human's supplied login handle for an authorized scan after the human confirms setup. Do not ask for, read, copy, inspect, upload, or embed saved-session contents, passwords, verification codes, browser databases, cookies, or API keys. Do not take over the login interaction even if an agent terminal can emulate a TTY.

The legacy CLI still supports `instaloader --login LOGIN_USERNAME` in a human terminal where that executable is available. Its `--session-file PATH` argument accepts a local path, never inline session material. Do not invent a path or search personal browser directories.

If login is expired, challenged, or rate-limited, report the state and leave recovery to the human. Do not switch accounts, bypass private-profile restrictions, or retry automatically. `orbit-os doctor` checks local storage, not login validity.

Only name an authentication problem when the observed result supports that diagnosis. The generic message `public following collection failed` does not identify a cause. Report it as an unknown provider failure and separate it from retained relationship evidence; do not claim that login expired or ask the human to reconnect speculatively.
