# Issue tracker: GitHub

Issues and specifications live in GitHub Issues for `deserteaglemj/orbitdiff`. Use `gh` from this checkout; verify the remote before a write.

- Read an issue and its discussion with `gh issue view NUMBER --comments`.
- List open issues with `gh issue list --state open --json number,title,labels`.
- Create an issue with `gh issue create --title TITLE --body-file FILE`.
- Update its body with `gh issue edit NUMBER --body-file FILE`.
- Add a comment with `gh issue comment NUMBER --body-file FILE` only when the task authorizes posting it.
- Apply mapped labels with `gh issue edit NUMBER --add-label LABEL`; remove stale labels with `--remove-label`.
- Close an issue only after its acceptance criteria pass. A blocked task stays open with the missing input and owner recorded.

Keep multiline bodies in a local file so newlines and literal text survive shell parsing. Use synthetic examples and public-safe evidence; personal exports, session references, local paths, and private receipts stay on the machine.

**PRs as a request surface: no.**

When a skill says to publish a specification or ticket, create a GitHub issue. Read the relevant issue and comments before implementation. For dependencies, use native GitHub issue dependencies when available; otherwise record `Blocked by: #NUMBER` in the dependent issue and verify those issues are closed before starting dependent work.
