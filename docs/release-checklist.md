# Release checklist

## Candidate

- [ ] Confirm publication authorization from the existing request or obtain it for a new scope.
- [ ] Confirm `git status --short` is empty and record the local HEAD.
- [ ] Review `CHANGELOG.md` for current-release impact statements.
- [ ] Verify the release repository and selected commit before any remote action.

## Verification

- [ ] `python -m pytest -q`
- [ ] `ruff check .`
- [ ] `mypy src`
- [ ] `python -m build`
- [ ] `python scripts/build_skill.py --output-dir dist`
- [ ] `python scripts/package_audit.py dist/*.whl dist/*.tar.gz dist/orbitdiff-skill-*.zip`
- [ ] Install the wheel in a clean virtual environment.
- [ ] Run both CLI version checks, doctor in an isolated workspace, and both offline demos from the clean environment.
- [ ] Generate synthetic skill scenarios with `scripts/prepare_skill_evals.py`, run the skill and comparison, and retain the evaluation evidence outside public source.
- [ ] `python scripts/public_safety_scan.py .`
- [ ] `gh skill publish --dry-run .`
- [ ] Verify every install command, URL, version, and expected demo output in `docs/prompt.md` matches the current release. The prompt is the first-run experience for most users.
- [ ] Scan for U+2014 em-dash, absolute home paths, local identifiers, saved-session files, databases, and credentials.

## Safety review

- [ ] Review package contents and git diff for credentials, local artifacts, and non-synthetic examples.
- [ ] Verify the provider exposes no password, verification-code, browser-data, or account-action surface.
- [ ] Verify private targets are rejected before following-list collection.
- [ ] Verify incomplete scans leave relationship state unchanged.
- [ ] Verify events contain only target, public account ID, username, event type, times, and run reference.

## Native app

- [ ] Use the isolated pinned toolchain and explicit build inputs in `docs/desktop-build.md`.
- [ ] Run `scripts/native_audit.py` against the app, including dependency licenses and file inventory.
- [ ] Verify extracted launch without external Python, local import/demo, native CSV save, and shutdown.
- [ ] Verify archive hashes, DMG contents, architecture, and platform signature.
- [ ] Assess a quarantined copy without bypassing protections. State blocked installation and signing limits plainly.

## External publication

When publication is authorized, require passing CI, publish the reviewed commit and immutable version tag, attach only audited public artifacts and checksums, and verify remote readback plus a pinned skill installation. Do not describe a Mac developer preview as a notarized consumer installer.
