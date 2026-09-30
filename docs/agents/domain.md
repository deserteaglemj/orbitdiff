# Domain documentation

This repository uses one root `CONTEXT.md` glossary for the shared relationship domain.

Before investigating domain behavior, read that glossary and any relevant files in `docs/adr/`. Proceed if an ADR directory is absent. Use the glossary's names in code, tests, specifications, and tickets.

Keep `CONTEXT.md` limited to domain terms and their meanings. Requirements and observable readiness gates belong in `docs/release-readiness.md`; verification results belong in the release-specific verification document. Create an ADR only for a consequential, hard-to-reverse decision with real alternatives. If proposed work contradicts an existing ADR, identify the conflict before changing behavior.
