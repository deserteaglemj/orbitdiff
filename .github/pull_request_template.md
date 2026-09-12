## Summary

- What changed?
- Why is it needed?

## Verification

- [ ] Focused tests were written first and observed red
- [ ] `python -m pytest -q`
- [ ] `ruff check .`
- [ ] `mypy src`
- [ ] `python -m build`
- [ ] Package-content and public-safety checks pass
- [ ] Agent Skill validation passes when skill files change

## Scope and safety

- [ ] No password, verification-code, browser-data, private-profile, or account-action surface was added
- [ ] No cloud, telemetry, daemon, content collection, or identity-enrichment scope was added
- [ ] Public examples use only synthetic data
- [ ] Public text contains no U+2014 em-dash
