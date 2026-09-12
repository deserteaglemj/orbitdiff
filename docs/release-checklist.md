# Release checklist

## Candidate

- [ ] Confirm the candidate is local only until publication is separately authorized.
- [ ] Confirm `git status --short` is empty and record the local HEAD.
- [ ] Review `CHANGELOG.md` for `0.1.0` impact statements.
- [ ] Confirm no remote, tag, release, or publication action is included in this checklist.

## Verification

- [ ] `python -m pytest -q`
- [ ] `ruff check .`
- [ ] `mypy src`
- [ ] `python -m build`
- [ ] `python scripts/package_audit.py dist/*`
- [ ] Install the wheel in a clean virtual environment.
- [ ] Run `orbitdiff --help`, `orbitdiff doctor`, and `orbitdiff demo` from the clean environment.
- [ ] `python scripts/public_safety_scan.py .`
- [ ] `gh skill publish --dry-run .`
- [ ] Scan for U+2014 em-dash, absolute home paths, local identifiers, saved-session files, databases, and credentials.

## Safety review

- [ ] Review package contents and git diff for credentials, local artifacts, and non-synthetic examples.
- [ ] Verify the provider exposes no password, verification-code, browser-data, or account-action surface.
- [ ] Verify private targets are rejected before following-list collection.
- [ ] Verify incomplete scans leave relationship state unchanged.
- [ ] Verify events contain only target, public account ID, username, event type, times, and run reference.

## External publication

Publication is not part of this checklist. A separately authorized publication run must re-verify source, remote ownership, tag, release artifact, and public readback.
