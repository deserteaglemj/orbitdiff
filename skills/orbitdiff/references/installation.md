# Install the runtime and skill separately

The skill is instructions; the runtime supplies the commands. Agents need local command execution and file access. A chat-only host cannot operate this workflow on the user's machine.

## Release availability

The minimum portable contract is stable version 0.2.0. Stable 0.2.x patches are compatible when their help exposes the requested commands. The current release pin is 0.2.1. These are different checks: an already verified compatible patch does not require replacement merely to match the pin. Older minors, prereleases, malformed version responses, and future minors require their own verified compatibility and matching instructions; do not assume a larger version is supported.

Resolve the user-selected executable first. If it is unsuitable, inspect other known local installations within the task's scope. Run each candidate's `--version`, explicitly compare the response with this contract, and check the requested commands with `--help`. Keep one verified executable path and one selected workspace for later steps. PATH order and exit code 0 alone do not establish compatibility.

If no compatible runtime exists, report the observed versions and that the workspace was not inspected. Use an already supplied verified checkout or wheel only when available and installation is authorized. Otherwise name the missing compatible runtime as the next input; do not invent a local candidate, silently download an older release, or replace unrelated installations. Verify a selected GitHub release before installing it. The older v0.1.1 tag lacks the portable personal workflow.

From a verified local checkout, use an isolated environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/orbit-os --version
.venv/bin/orbit-os demo
```

Retain `.venv/bin/orbit-os` as the executable for later instructions; creating a virtual environment does not add it to PATH. On Windows retain `.venv/Scripts/orbit-os.exe`. These are source-install instructions; Windows runtime and packaging verification must be reported separately. If an existing environment already contains OrbitDiff, inspect its version and avoid replacing unrelated packages.

Once release v0.2.1 is published and verified, an existing pipx installation can install the pinned runtime:

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.2.1
orbit-os --version
orbit-os demo
```

The original `orbitdiff demo` is an additional compatibility check only when the separate `orbitdiff` executable is available. The portable workflow needs only `orbit-os`.

If pipx is missing, use the isolated source environment above or the user's established package manager. Do not assume administrator rights or install unrelated tools. Run the offline proof before any authorized live collection.

Existing-data inspection uses `status`, `relationships`, `targets`, or `report` with the verified executable. Use `doctor` only for authorized new-workspace setup or storage diagnostics; it can create a directory and change permissions. An offline demo does not require initializing a real workspace.

## Agent Skill

For a local candidate, copy the entire `orbitdiff` directory from the audited skill ZIP into the host's supported skill directory. Retain the references, assets, and optional `agents` metadata. The ZIP contains the MIT license and no runtime, personal data, or saved session.

GitHub CLI with its skill commands can also install the local checkout:

```bash
gh skill install . orbitdiff --from-local --agent codex --scope user
```

After the matching GitHub release exists:

```bash
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.1 --agent codex --scope user
```

Select the user's actual host with `--agent`, for example `claude-code`, `cursor`, `github-copilot`, `gemini-cli`, or another value listed by `gh skill install --help`. GitHub CLI is optional; the core workflows use ordinary commands and do not depend on a vendor-specific agent tool.

## Desktop app

The standalone Orbit OS app is a separate download with a bundled runtime. Installing the skill does not install that app. The bundled command is named `orbit-os`, commonly at `/Applications/Orbit OS.app/Contents/MacOS/orbit-os`. Locate the actual installed app and retain that full executable path for all CLI steps; for example:

```bash
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" --version
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" demo
```

The bundle does not add a global `orbit-os` command or provide a separate `orbitdiff` executable. It can use the same portable workspace and import/report/scan commands through its bundled executable.

Consult the repository release's platform evidence and checksums. A locally built macOS candidate may be unsigned and not notarized; do not promise frictionless Gatekeeper installation or tell users to disable platform protections. Windows and Linux packages remain unverified until their own builds and launch tests pass.

Runtime installation can download dependencies. Local storage and webview memory are used; the app itself introduces no paid model API, cloud subscription, telemetry, or new scheduler. Normal agent-host charges, if any, are outside the app. Use the user's existing resource and installation authorization.
