# Install the runtime and skill separately

The skill is instructions; the runtime supplies the commands. Agents need local command execution and file access. A chat-only host cannot operate this workflow on the user's machine.

## Release availability

This skill requires version 0.2.0. Verify the selected GitHub release or local candidate before installation. The older v0.1.1 tag does not include the portable personal workflow. Never silently substitute an older runtime.

From a verified local checkout, use an isolated environment:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/orbit-os --version
.venv/bin/orbit-os demo
```

Retain `.venv/bin/orbit-os` as the executable for later instructions; creating a virtual environment does not add it to PATH. On Windows retain `.venv/Scripts/orbit-os.exe`. These are source-install instructions; Windows runtime and packaging verification must be reported separately. If an existing environment already contains OrbitDiff, inspect its version and avoid replacing unrelated packages.

Once release v0.2.0 is published and verified, an existing pipx installation can install the pinned runtime:

```bash
pipx install git+https://github.com/deserteaglemj/orbitdiff.git@v0.2.0
orbit-os --version
orbit-os demo
```

The original `orbitdiff demo` is an additional compatibility check only when the separate `orbitdiff` executable is available. The portable workflow needs only `orbit-os`.

If pipx is missing, use the isolated source environment above or the user's established package manager. Do not assume administrator rights or install unrelated tools. Run the offline proof before any authorized live collection.

## Agent Skill

For a local candidate, copy the entire `orbitdiff` directory from the audited skill ZIP into the host's supported skill directory. Retain the references, assets, and optional `agents` metadata. The ZIP contains the MIT license and no runtime, personal data, or saved session.

GitHub CLI with its skill commands can also install the local checkout:

```bash
gh skill install . orbitdiff --from-local --agent codex --scope user
```

After the matching GitHub release exists:

```bash
gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.0 --agent codex --scope user
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
