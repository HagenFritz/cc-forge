---
date: 2026-04-29
topic: ship-skill-improvements
---

# Ship Skill Improvements

## Problem Frame

The `/ship` skill has two reliability gaps that surface on every use:

1. **Issue not linked** — the branch name contains the issue number, but the PR body uses a cross-reference format (`owner/repo#N`) that GitHub does not recognize as an official link. The issue must be manually linked after the fact.
2. **No confirmation before PR creation** — unlike `/issue-from-context`, the PR is created immediately with no preview or confirmation step. Title or body mistakes require editing the PR manually after creation.

## Requirements

- R1. The PR body must include a `Closes #N` line (or equivalent keyword) derived from the issue number in the branch name so that GitHub registers an official issue link. If the branch has no issue number (e.g. uses `no-ref`), omit the closing keyword.
- R2. Before creating the PR, display a full confirmation preview showing: PR title, source branch → target branch, linked issue number, and the full PR body.
- R3. The preview must be presented via `AskUserQuestion` with options: **Confirm**, **Cancel**, and **Other** (free-form). If the user cancels, stop without creating the PR. If the user provides free-form input via Other, treat it as a revised title and/or body revision notes, regenerate accordingly, and re-show the preview.
- R4. The branch is pushed to remote before the preview is shown. A cancelled preview leaves the branch pushed but creates no PR — this is acceptable.
- R5. The `Related Issue` section in the PR body retains the existing cross-reference format for human-readable context; the `Closes #N` line is added separately (e.g. at the top of the body or as a dedicated line before the template sections).

## Success Criteria

- Running `/ship` on a branch like `feat/42/some-desc` produces a PR that GitHub automatically links to issue #42, with no manual linking required.
- The user sees the full PR body before it is created and can correct the title or add revision notes before confirming.

## Scope Boundaries

- No change to the commit grouping or push logic beyond push timing (push happens before preview, same as today).
- No support for linking multiple issues from a single branch — only the first issue number in the branch name is used.
- Editing the full raw PR body directly is out of scope; revision notes are the supported edit path.

## Key Decisions

- **References only (not auto-close):** User chose to keep the current `owner/repo#N` cross-reference and *not* use `Closes #N` for auto-close. The goal is a visible, clickable link in the PR — GitHub's sidebar link — rather than auto-closing behavior. Implementation should use the cross-reference but ensure it actually registers as a link GitHub recognizes (may require just `#N` without owner/repo prefix within the same repo, or explicit `Closes` keyword if cross-reference alone is insufficient).
- **Push before preview:** Branch is pushed first; preview is shown after. Cancelled preview = pushed branch, no PR. Acceptable.
- **Edit scope:** Other input accepts revised title and/or body revision notes; skill regenerates based on that input and re-shows the preview.

## Dependencies / Assumptions

- Branch naming convention `type/issue-number/description` is assumed. Branches without an issue number segment use `no-ref` or a non-numeric second segment.
- `AskUserQuestion` is available in the skill's `allowed-tools`.

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Needs research] Does `owner/repo#N` in the PR body create a GitHub sidebar link, or does only `#N` (same-repo shorthand) or `Closes #N` actually register the link? Validate with `gh` CLI or GitHub docs before choosing the exact format.

## Next Steps

→ /plan for structured implementation planning
