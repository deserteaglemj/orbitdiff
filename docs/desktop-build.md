# Build the standalone desktop app

Orbit OS has two separate distributions: the portable `orbitdiff` Agent Skill and the standalone desktop app. The desktop app bundles Python, the local server, its interface, and the same command-line workflows. Users do not need an AI agent, a source checkout, or a separate Python installation.

## Platform and release status

The latest patch verification and exact artifact checksums are recorded in [0.2.1 verification](verification-0.2.1.md). The historical 0.2.0 results below remain unchanged.

The current recipe targets Apple Silicon macOS with macOS 13 or newer declared in the bundle. Runtime verification is performed on the actual build machine; the declared minimum is not a claim that every supported macOS release has been tested. Intel macOS, Windows, and Linux do not have verified artifacts from this recipe. They require their own native builds and installation checks.

The candidate uses an ad-hoc signature. It does not have a Developer ID signature or Apple notarization. A valid ad-hoc signature confirms local bundle integrity; it does not establish a trusted publisher or guarantee downloaded-file launch approval. A public release must state that limitation and include the recorded quarantine result. Never disable Gatekeeper to make a test pass.

## Reproduce an isolated build

Run these commands from the repository root on Apple Silicon macOS with `uv` available. No paid service or model API is used. The approved build budget is 2 GiB RAM and 2 GiB temporary disk, with one build at a time.

```sh
uv python install 3.13.12 --install-dir .orbit-local/python-runtime --no-bin --no-registry
uv venv --python .orbit-local/python-runtime/cpython-3.13.12-macos-aarch64-none/bin/python3 .orbit-local/desktop-managed-venv
uv pip install --python .orbit-local/desktop-managed-venv/bin/python -r packaging/desktop-requirements.txt
.orbit-local/desktop-managed-venv/bin/python scripts/build_desktop.py --dmg
```

The managed Python interpreter avoids inheriting framework installer debug paths from a system interpreter. The requirements file pins the complete native toolchain. Build caches and the environment stay under ignored `.orbit-local/`. A checkout-wide lock prevents simultaneous native builds. The build has a 15-minute timeout and records peak child memory.

The output directory must be new. For a later candidate, choose separate output and work directories:

```sh
.orbit-local/desktop-managed-venv/bin/python scripts/build_desktop.py --output dist/desktop-next --work .orbit-local/desktop-next-build --dmg
```

The result includes `Orbit OS.app`, a versioned ZIP, an optional DMG, and `SHA256SUMS.txt`. The PyInstaller intermediate directory is not an additional user distribution. Copy the app to Applications after extracting the ZIP or opening the disk image.

The app starts an ephemeral loopback server and opens a native WebKit window. Closing that window stops its owned server. It installs no daemon, login item, or schedule. Personal imports stay in the chosen private workspace. Explicit compatibility mode keeps external source data read-only.

## Use the bundled commands

The same executable provides command-line access when arguments are supplied:

```sh
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" --help
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" doctor
"/Applications/Orbit OS.app/Contents/MacOS/orbit-os" login YOUR_INSTAGRAM_USERNAME
```

Login requires a human-operated terminal. Passwords and verification codes are not command arguments or chat inputs. Launching the app or refreshing its view never performs a collector login or scan.

## Verify the exact artifact

The strict skill and Python archive audit remains unchanged. Native bundles use a separate audit because their runtime includes large binaries and internal framework links:

```sh
.orbit-local/desktop-managed-venv/bin/python scripts/native_audit.py "dist/desktop/Orbit OS.app"
codesign --verify --deep --strict "dist/desktop/Orbit OS.app"
shasum -a 256 dist/desktop/Orbit-OS-*.zip dist/desktop/Orbit-OS-*.dmg
```

The native audit checks the runtime allowlist, member and archive size bounds, sensitive names and private literals, internal relative link destinations, per-file hashes, dependency licenses, and the app signature. The executable is verified by its platform signature because hashing a binary that signs its own inventory would create a circular dependency. Pass additional known-private literals using repeated `--forbid` options when auditing a release on a machine that contains personal trackers.

The build includes only an explicit web-asset list and three synthetic collector fixtures. It does not recursively copy the checkout, user workspace, Hermes files, or saved sessions. Dependency versions and license paths are recorded in `Contents/Resources/orbit-distribution.json`; full license texts are included under `Contents/Resources/licenses/`.

Before a release, extract the ZIP into a fresh directory outside the checkout and verify the native window, bundled CLI, empty first run, synthetic import, search, export, restart, and process shutdown. Repeat the launch check with downloaded-file quarantine applied to a separate test copy and record Gatekeeper's actual decision. A local launch without quarantine does not prove a browser-downloaded consumer installation works.

For an initial toolchain check, `--feasibility` builds a synthetic window that closes automatically. It is not the release application. PyInstaller packages for one native platform at a time; another platform requires a reviewed recipe, its own runtime dependencies, and the same installation checks. [pywebview packaging guidance](https://pywebview.flowrl.com/guide/freezing.html) documents alternate bundlers, including py2app for macOS, if native compatibility needs a future change.

## Verified 0.2.0 candidate

The 0.2.0 Apple Silicon candidate was built with managed Python 3.13.12 and the pinned native toolchain, then verified on macOS 26.6.2 arm64. The final app contains the approved Orbit mark converted from its existing SVG with macOS graphics tools.

| Check | Observed result |
| --- | --- |
| Native content and signature | Runtime audit and deep, strict signature verification pass |
| Relocated ZIP extraction | Bundled version, readiness, and offline demo commands pass outside the checkout with no external Python on PATH |
| Native window | Extracted app opens to an empty first run; its isolated demo displays expected relationships |
| Native export | macOS Save dialog writes a CSV with the three expected synthetic demo rows |
| Demo isolation and shutdown | Exiting the demo leaves the real workspace empty; closing the window closes its local port |
| DMG | Read-only mount contains the app at its root; its signature verifies |
| Runtime and package size | Installed app 26,013,773 bytes; ZIP 12,956,475 bytes; DMG 13,915,521 bytes |
| Build resource use | Measured peak child memory 194.7 MiB |
| Quarantine | Gatekeeper assessment rejects the quarantined app with exit code 3; protections were not changed |

This is an ad-hoc-signed developer candidate, with no Team Identifier or Apple notarization. It is not a claim of frictionless browser-download installation. Live Instagram collection and human terminal login were not exercised during these offline checks. The bundled login module is present and unattended login correctly refuses to continue. Other operating systems and older macOS releases remain unverified.
