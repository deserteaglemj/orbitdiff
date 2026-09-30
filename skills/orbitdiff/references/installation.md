# Install the skill and runtime separately

Daily alerts require the unreleased 0.2.3 candidate and the capability checks in [scheduling](scheduling.md). The published v0.2.2 recipes below retain their original commands and do not supply daily alerts. Install a reviewed candidate only from its audited wheel and matching complete skill archive; record its commit and hashes.

The skill supplies instructions. The runtime supplies `orbit-os` commands. Install only the requested pieces, using the user's existing authorization and selected project. A chat-only host cannot operate local files or commands.

For runtime setup, first inspect any known local executable using [the main skill's compatibility contract](../SKILL.md). Retain a compatible executable and its actual path; PATH order or exit code 0 alone is insufficient. Do not replace an unrelated installation. If none qualifies, stop dependent workspace commands until authorized setup succeeds and report that workspace evidence remains uninspected. Skill-only installation needs no runtime check.

## Choose the installation source

[GitHub prerelease v0.2.2](https://github.com/deserteaglemj/orbitdiff/releases/tag/v0.2.2) is published. Its Python runtime version is `0.2.2`; the GitHub preview label is separate from the runtime version comparison. Confirm the selected tag, assets, and checksums when installing. The older v0.1.1 release lacks the portable personal workflow.

A local checkout can contain unpublished changes with the same version. Label its build as a candidate and use its own audited artifacts, not the published release's checksum as proof of those changes. The [installation verification record](https://github.com/deserteaglemj/orbitdiff/blob/main/docs/skill-installation-verification.md) separates candidate checks, published checks, and actual host evidence.

## Install into the selected agent project

When an existing GitHub CLI supports `gh skill install --help`, run the command for the actual host from the selected project. Do not run every row or add `--force`.

| Host | Published skill command | Project destination reported by the installer |
| --- | --- | --- |
| Codex | `gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.2 --agent codex --scope project` | `.agents/skills/orbitdiff` |
| Claude Code | `gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.2 --agent claude-code --scope project` | `.claude/skills/orbitdiff` |
| Cursor | `gh skill install deserteaglemj/orbitdiff orbitdiff --pin v0.2.2 --agent cursor --scope project` | `.agents/skills/orbitdiff` |

These are placement routes, not proof that a host discovered or executed the skill. Check the installed CLI's help because destinations can change. `--dir PATH` overrides both `--agent` and `--scope`; a custom directory needs separate host-discovery verification. Stop on an existing destination and report it instead of replacing it. Use separate projects to evaluate hosts that share a destination.

For an authorized local candidate, use the verified checkout path instead of the remote repository:

```bash
gh skill install CHECKOUT_PATH orbitdiff --from-local --agent codex --scope project
```

Select the actual host in that command too. GitHub CLI can add source-tracking metadata and normalize frontmatter formatting. Verify original values, instruction body, references, and assets are preserved; do not assume a byte difference is harmless. Use the archive route below if skill commands are unavailable, without installing another tool just for this step.

## Archive fallback and isolated runtime

Use an existing Python 3.11+ installation for this recipe. Replace `DOWNLOAD_DIR`, `SKILL_PARENT`, and `RUNTIME_ENV` with chosen paths, each kept as one quoted argument when it contains spaces. `SKILL_PARENT` is the selected project's `.agents/skills` or `.claude/skills` directory from the table; use `-` instead when installing only the runtime. Run each step only after the previous step succeeds.

1. Download `SHA256SUMS.txt` and only the requested release assets into a new download directory: the ZIP for the skill, the wheel for the runtime. Use the release page if GitHub CLI is absent. With an existing CLI, run the manifest command and the applicable asset command(s), without overwrite flags:

```bash
gh release download v0.2.2 --repo deserteaglemj/orbitdiff --dir DOWNLOAD_DIR --pattern SHA256SUMS.txt
# Skill requested:
gh release download v0.2.2 --repo deserteaglemj/orbitdiff --dir DOWNLOAD_DIR --pattern orbitdiff-skill-0.2.2.zip
# Runtime requested:
gh release download v0.2.2 --repo deserteaglemj/orbitdiff --dir DOWNLOAD_DIR --pattern orbitdiff-0.2.2-py3-none-any.whl
```

2. Verify the downloaded assets against the release manifest. When `SKILL_PARENT` is a path, extract the complete skill into a new `orbitdiff` directory. This check rejects modified assets, unsafe archive members, and an existing destination. With `SKILL_PARENT` set to `-`, it only verifies assets. It does not install the runtime:

```bash
python3 - DOWNLOAD_DIR SKILL_PARENT <<'PY'
import hashlib
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

downloads = Path(sys.argv[1])
names = tuple(name for name in (
    "orbitdiff-skill-0.2.2.zip", "orbitdiff-0.2.2-py3-none-any.whl"
) if (downloads / name).is_file())
if not names:
    raise SystemExit("No selected release assets found")
checksums = {}
for line in (downloads / "SHA256SUMS.txt").read_text().splitlines():
    if not line.strip():
        continue
    match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
    if match is None or match[2] in checksums:
        raise SystemExit("Invalid or duplicate checksum entry")
    checksums[match[2]] = match[1]
for name in names:
    actual = hashlib.sha256((downloads / name).read_bytes()).hexdigest()
    if checksums.get(name) != actual:
        raise SystemExit(f"Checksum mismatch or missing entry: {name}")
print("Verified release assets: " + ", ".join(names))
if sys.argv[2] == "-":
    raise SystemExit(0)

parent = Path(sys.argv[2])
contents = {}
with zipfile.ZipFile(downloads / "orbitdiff-skill-0.2.2.zip") as archive:
    for member in archive.infolist():
        path = PurePosixPath(member.filename)
        mode = stat.S_IFMT(member.external_attr >> 16)
        if (path.is_absolute() or len(path.parts) < 2
                or path.parts[0] != "orbitdiff" or ".." in path.parts
                or "\\" in member.filename or str(path) != member.filename
                or mode not in (0, stat.S_IFREG) or member.is_dir()
                or member.filename in contents):
            raise SystemExit("Unsafe or duplicate skill archive member")
        contents[member.filename] = archive.read(member)
if "orbitdiff/SKILL.md" not in contents:
    raise SystemExit("Skill archive has no SKILL.md")
destination = parent / "orbitdiff"
destination.mkdir(parents=True, exist_ok=False)
for name, data in contents.items():
    output = parent / name
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as handle:
        handle.write(data)
print(f"Installed skill at {destination}")
PY
```

3. If runtime installation was requested, create a new isolated environment and install the already verified wheel. The first command refuses an existing environment. Keep the resulting executable path for every later command; activation and global PATH changes are unnecessary.

```bash
python3 -c 'import sys, venv; from pathlib import Path; p = Path(sys.argv[1]); p.mkdir(parents=True, exist_ok=False); venv.EnvBuilder(with_pip=True).create(p)' RUNTIME_ENV
RUNTIME_ENV/bin/python -m pip install DOWNLOAD_DIR/orbitdiff-0.2.2-py3-none-any.whl
RUNTIME_ENV/bin/orbit-os --version
RUNTIME_ENV/bin/orbit-os --help
RUNTIME_ENV/bin/orbit-os demo
```

These shell examples target macOS/Linux. Windows environment executables use `Scripts/python.exe` and `Scripts/orbit-os.exe`; Windows installation and consuming-host behavior remain unproven. Do not report these examples as platform verification. Runtime installation can download declared dependencies. Use existing package access and resource authorization; no global install, administrator access, or paid model API is required by OrbitDiff.

## Verify each requested result

For skill setup, open a fresh host session in the selected project and verify it discovers `orbitdiff`, reads the installed `SKILL.md`, and resolves a bundled reference. Report host version, project, installed path, and observed evidence. A copied folder or `gh skill list` entry alone is placement evidence. If authentication or host selection is unavailable, label discovery and execution unproven; do not change accounts or buy access.

For runtime setup, apply the main skill's version/help check to the retained executable and confirm `demo` returns separate synthetic personal and public data. The legacy `orbitdiff demo` is optional. The demo must not populate the selected real workspace. Run `doctor` only for requested workspace setup or storage diagnostics: it can create directories and change permissions. Existing-data inspection needs neither setup nor a demo.

Finish with separate results for skill placement, host discovery, runtime execution, and any requested workflow. A fresh consuming-agent run is stronger evidence than shell smoke tests; neither proves every host or platform. Consult the linked verification record for measured results and limits.

## Separate desktop app

The Orbit OS desktop app is a separate download with its own bundled runtime. If already installed, locate the actual executable, commonly `/Applications/Orbit OS.app/Contents/MacOS/orbit-os`, and retain that full path. It supplies no global PATH command or separate `orbitdiff` executable.

The native preview is Apple Silicon macOS only, ad-hoc signed and not notarized. Check the selected release's checksums and platform evidence; preserve Gatekeeper protections. Intel Mac, Windows, and Linux packages remain unverified.

For authorized browser launch, use the retained executable with `app --open --workspace PATH`; for the bundled desktop runtime use `app --desktop --workspace PATH`. Finish when the view loads the selected workspace and shows source status, or report the observed blocker. A loaded window, demo, or storage check does not establish live collection. Apply the main skill's separate live-readiness requirement if tracking was requested.
