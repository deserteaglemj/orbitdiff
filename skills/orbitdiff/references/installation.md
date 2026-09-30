# Install the runtime and skill separately

The skill is instructions; the runtime supplies the commands. Agents need local command execution and file access. A chat-only host cannot operate this workflow on the user's machine.

## Release availability

The candidate release pin is 0.2.2; publication is not established by this document. Use [the main skill's compatibility contract](../SKILL.md) to decide whether an installed runtime qualifies. A verified compatible patch does not require replacement merely to match the candidate pin.

For authorized installation, resolve the user-selected executable first and apply that compatibility check to known local candidates. Keep one verified executable path and one selected workspace for later steps. PATH order and exit code 0 alone do not establish compatibility.

If no compatible runtime exists, report the observed versions and that the workspace was not inspected. Use an already supplied verified checkout or wheel only when available and installation is authorized. Otherwise name the missing compatible runtime as the next input; do not invent a local candidate, silently download an older release, or replace unrelated installations. Verify a selected GitHub release before installing it. The older v0.1.1 tag lacks the portable personal workflow.

From a verified local checkout, use an isolated environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/orbit-os --version
.venv/bin/orbit-os demo
```

Retain `.venv/bin/orbit-os` as the executable for later instructions; creating a virtual environment does not add it to PATH. On Windows retain `.venv/Scripts/orbit-os.exe`. These are source-install instructions; Windows runtime and packaging verification must be reported separately. If an existing environment already contains OrbitDiff, inspect its version and avoid replacing unrelated packages.

Once release v0.2.2 is published and verified, an existing pipx installation can install the pinned runtime:

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.2.2
orbit-os --version
orbit-os demo
```

The original `orbitdiff demo` is an additional compatibility check only when the separate `orbitdiff` executable is available. The portable workflow needs only `orbit-os`.

If pipx is missing, use the isolated source environment above or the user's established package manager. Do not assume administrator rights or install unrelated tools. Run the offline proof before any authorized live collection.

Finish runtime setup when the retained executable passes the compatibility check and its isolated demo returns synthetic personal and public data. If new-workspace setup or storage diagnostics were requested, run `doctor` for that selected workspace and inspect its issues. It can create the directory and change permissions; it proves local storage readiness only. Existing-data inspection follows the main skill's stored-read route and needs no setup or demo.

## Agent Skill

For a local candidate, copy the entire `orbitdiff` directory from the audited skill ZIP into the host's supported skill directory. Retain the references, assets, and optional `agents` metadata. The ZIP contains the MIT license and no runtime, personal data, or saved session.

GitHub CLI with its skill commands can also install the local checkout:

```bash
gh skill install . orbitdiff --from-local --agent codex --scope user
```

After the matching GitHub release exists:

```bash
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.2 --agent codex --scope user
```

Select the user's actual host with `--agent`, for example `claude-code`, `cursor`, `github-copilot`, `gemini-cli`, or another value listed by `gh skill install --help`. GitHub CLI is optional; the core workflows use ordinary commands and do not depend on a vendor-specific agent tool.

Finish skill setup when the host can discover `orbitdiff` and its installed references resolve. Report runtime setup separately; a copied skill folder does not prove commands are available.

## Desktop app

The standalone Orbit OS app is a separate download with a bundled runtime. Installing the skill does not install that app. The bundled command is named `orbit-os`, commonly at `/Applications/Orbit OS.app/Contents/MacOS/orbit-os`. Locate the actual installed app and retain that full executable path for all CLI steps; for example:

```bash
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" --version
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" demo
```

The bundle does not add a global `orbit-os` command or provide a separate `orbitdiff` executable. It can use the same portable workspace and import/report/scan commands through its bundled executable.

The current native preview is Apple Silicon macOS only, ad-hoc signed and not notarized. Consult the selected release's platform evidence and checksums. Do not promise frictionless Gatekeeper installation or tell users to disable platform protections. Intel Mac, Windows, and Linux packages remain unverified until their own builds and launch tests pass.

For an authorized browser launch, use the retained executable with `app --open --workspace PATH`; for the bundled desktop runtime, use `app --desktop --workspace PATH`. App launch is complete when the view loads the selected workspace and displays its source status. A launch error, unreadable source, or blocked platform prompt must be reported. If live tracking was requested, complete a bounded manual live collection for the selected target before calling that workflow ready. A demo, `doctor`, or loaded window is only local proof.

Runtime installation can download dependencies. Local storage and webview memory are used; the app itself introduces no paid model API, cloud subscription, telemetry, or new scheduler. Normal agent-host charges, if any, are outside the app. Use the user's existing resource and installation authorization.
