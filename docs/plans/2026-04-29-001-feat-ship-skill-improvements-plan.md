---
title: "feat: Improve /ship skill with confirmation preview, issue linking, and existing-PR handling"
type: feat
status: completed
date: 2026-04-29
origin: docs/brainstorms/2026-04-29-ship-skill-improvements-requirements.md
---

# feat: Improve /ship skill with confirmation preview, issue linking, and existing-PR handling

## Overview

Three improvements to the `/ship` skill:

1. **Confirmation preview** — before creating a PR, show a full preview via `AskUserQuestion` so the user can confirm, cancel, or revise.
2. **Issue linking** — parse the issue number from the branch name and include `#N` in the PR body so GitHub registers a cross-reference mention.
3. **Existing-PR path** — when a PR is already open for the current branch, commit + push the new changes and add a comment to the existing PR summarizing what changed, instead of trying to create a duplicate.

## Problem Frame

The current `/ship` skill creates a PR immediately with no review step, and doesn't include any issue reference in the PR body that GitHub recognizes. Additionally, re-running `/ship` after additional changes on an already-shipped branch has no defined behavior — it would attempt to create a duplicate PR.

(see origin: docs/brainstorms/2026-04-29-ship-skill-improvements-requirements.md)

## Requirements Trace

- R1. PR body includes a bare `#N` reference derived from the branch name's issue number segment so GitHub registers a cross-reference mention in the issue timeline.
- R2. A full confirmation preview is shown before PR creation via `AskUserQuestion`.
- R3. Preview offers Confirm, Cancel, and Other (revision notes); Other triggers a regenerate + re-preview loop.
- R4. Branch is pushed before the preview is shown; cancelled preview leaves branch pushed but no PR created.
- R5. `Related Issue` section retains the cross-reference `owner/repo#N` format alongside the new bare `#N` line.
- R6. (New — from user request) When a PR already exists for the branch, commit and push new changes, then add a `gh pr comment` summarizing what changed. Do not attempt to create a new PR.

## Scope Boundaries

- No auto-close behavior (`Closes #N` is explicitly excluded — see Key Technical Decisions).
- Only the first issue number in the branch name is used; multi-issue branches are out of scope.
- The confirmation preview does not allow editing the raw PR body — only a revised title and/or revision notes via free-form Other input.
- No change to commit grouping or push logic beyond the existing PR detection branch.
- The PR comment on the existing-PR path is a summary of new commits/files — it does not replace or rewrite the original PR body.

## Context & Research

### Relevant Code and Patterns

- `skills/ship/SKILL.md` — the skill to modify; currently has `disable-model-invocation: true` which must be removed (interactive `AskUserQuestion` requires model invocation)
- `skills/ship/pr-template.md` — PR body template; already documents issue-number extraction from branch name; must add `#N` line to template
- `skills/issue-from-context/SKILL.md` (step 5a) — canonical `AskUserQuestion` confirmation preview pattern to mirror
- `skills/branch/SKILL.md` — source of truth for branch naming convention `{prefix}/{issue-number}/{short-description}`

### Institutional Learnings

None relevant found in docs/solutions/.

### External References

- GitHub Docs: Linking a pull request to an issue — confirms bare `#N` creates a cross-reference mention; only closing keywords (`Closes`, `Fixes`, `Resolves`) create the sidebar Development link.
- There is no GitHub keyword that links without auto-closing. The user chose bare `#N` for cross-reference only.

## Key Technical Decisions

- **Bare `#N`, not `Closes #N`**: User explicitly chose cross-reference mention over sidebar Development link to avoid auto-closing issues on merge. This is the resolved form of the outstanding question from the origin document.
- **Remove `disable-model-invocation: true`**: The current flag prevents mid-skill model reasoning. `AskUserQuestion` for the confirmation preview and the existing-PR detection branch both require model reasoning. Remove this flag. The `/branch` skill omits this flag and uses `AskUserQuestion` freely — that's the pattern to follow.
- **Add `AskUserQuestion` to `allowed-tools`**: Required for the confirmation step.
- **Existing PR detection via `gh pr view`**: Run `gh pr view --json number,url,state 2>/dev/null` early in Phase 3. Non-zero exit = no PR exists (normal path). Zero exit = PR already open (update path).
- **PR comment content**: When updating an existing PR, generate the comment from the new commits (since the last push) and changed files. Use `git log origin/<branch>..HEAD --oneline` to enumerate new commits and `git diff --stat origin/<branch>..HEAD` for changed files. The comment should be human-readable, not a raw diff.
- **Issue number extraction**: Parse the second `/`-delimited segment of the branch name. If it is not numeric, or if the branch is `no-ref` or doesn't follow the convention, omit the `#N` line gracefully.

## Open Questions

### Resolved During Planning

- **Does `owner/repo#N` create a GitHub sidebar link?** No — only closing keywords create the Development sidebar link. Bare references (`#N` or `owner/repo#N`) create only a cross-reference mention. User chose bare `#N`. (see origin deferred question, resolved by external research)

### Deferred to Implementation

- Exact regex or string-split logic for branch name parsing — straightforward but implementation-detail.
- Whether the PR comment for the existing-PR path should use a structured format (e.g., markdown list of commits) or prose — implementer should use `issue-from-context` comment style as a loose reference.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
/ship invoked
    │
    ├── Safety check (branch ≠ main/master)
    │
    ├── Phase 1: Commit uncommitted changes (unchanged)
    │
    ├── Phase 2: Understand full branch diff (unchanged)
    │
    ├── Phase 3: Detect existing PR
    │       │
    │       ├── PR exists → Update path
    │       │       ├── git push
    │       │       ├── generate comment (new commits + changed files)
    │       │       └── gh pr comment <number> --body "..."
    │       │
    │       └── No PR → New PR path
    │               ├── git push
    │               ├── parse issue number from branch name
    │               ├── generate PR title + body (with #N and owner/repo#N)
    │               ├── AskUserQuestion preview loop
    │               │       ├── Confirm → gh pr create
    │               │       ├── Cancel → stop
    │               │       └── Other → regenerate + loop
    │               └── output PR URL
```

## Implementation Units

- [ ] **Unit 1: Remove `disable-model-invocation` and add `AskUserQuestion` to frontmatter**

**Goal:** Enable interactive mid-skill model reasoning and the `AskUserQuestion` tool.

**Requirements:** Prerequisite for R2, R3, R6.

**Dependencies:** None.

**Files:**
- Modify: `skills/ship/SKILL.md` (frontmatter only)

**Approach:**
- Remove the `disable-model-invocation: true` line
- Add `AskUserQuestion` to the `allowed-tools` list

**Patterns to follow:**
- `skills/issue-from-context/SKILL.md` frontmatter — canonical reference for skills that use `AskUserQuestion`

**Test scenarios:**
- Skill can be invoked and reach an `AskUserQuestion` call without errors

**Verification:**
- Frontmatter matches the pattern from `issue-from-context` for tools used

---

- [ ] **Unit 2: Add `#N` issue reference to PR body template**

**Goal:** Ensure every PR body includes a bare `#N` reference when the branch has a numeric issue segment, creating a GitHub cross-reference mention.

**Requirements:** R1, R5.

**Dependencies:** None (template change is independent).

**Files:**
- Modify: `skills/ship/pr-template.md`

**Approach:**
- Add a `#N` line at the top of the template (before the `### Related Issue` section), using a placeholder that instructs the skill to substitute the parsed issue number
- The `### Related Issue` section keeps its current `owner/repo#N` cross-reference format
- If no issue number is found (non-numeric or `no-ref`), this line is omitted
- Frame the placeholder as instruction prose in the template, consistent with how the existing `### Related Issue` section already documents its own extraction logic

**Patterns to follow:**
- Existing `### Related Issue` section in `pr-template.md` for how extraction instructions are documented inline

**Test scenarios:**
- Branch `feat/42/foo` → PR body includes `#42` and `HagenFritz/cc-forge#42`
- Branch `feat/no-ref/foo` → no `#N` line; `### Related Issue` shows "N/A"
- Branch without issue segment → degrades gracefully, no error

**Verification:**
- Template produces both a bare `#N` line and the existing cross-reference line for a standard branch

---

- [ ] **Unit 3: Add existing-PR detection and update path to Phase 3**

**Goal:** When a PR is already open for the current branch, push new commits and add a comment instead of creating a duplicate PR.

**Requirements:** R6.

**Dependencies:** Unit 1 (model invocation allowed).

**Files:**
- Modify: `skills/ship/SKILL.md` (Phase 3 section)

**Approach:**
- At the start of Phase 3, run `gh pr view --json number,url,state 2>/dev/null` to detect an open PR
- **If PR exists:** push the branch, then run `git log origin/<branch>..HEAD --oneline` and `git diff --stat origin/<branch>..HEAD` to gather what's new. Generate a concise comment body listing new commits and changed files. Post via `gh pr comment <number> --body "..."`. Output the PR URL.
- **If no PR:** continue to the current push + create flow (Units 4 and 5)
- The comment should be human-readable: a short summary sentence, then a list of new commits, then a changed-files summary
- No `AskUserQuestion` preview on the update path — it's additive and low-risk

**Patterns to follow:**
- `gh pr comment` usage pattern from `gh` CLI conventions
- Comment style: brief, structured, similar to how `/issue-from-context` writes issue bodies

**Test scenarios:**
- Branch with an open PR: new commits are pushed and a comment appears on the existing PR; no new PR is created
- Branch with a merged/closed PR: `gh pr view` returns non-open state; skill should treat this as "no open PR" and create a new one (or surface an error — implementer judgment)
- Branch with no PR: normal new-PR path proceeds unchanged

**Verification:**
- Running `/ship` twice on the same branch (with new commits the second time) results in one PR with a new comment, not two PRs

---

- [ ] **Unit 4: Parse issue number and generate PR body with `#N`**

**Goal:** Extract the issue number from the branch name and inject it into the generated PR body.

**Requirements:** R1, R5.

**Dependencies:** Unit 2 (template updated).

**Files:**
- Modify: `skills/ship/SKILL.md` (Phase 3 — new PR path, body generation step)

**Approach:**
- After detecting no existing PR, parse the branch name: split on `/`, take the second segment, check if it is a positive integer
- If numeric: store as issue number; this will be substituted into the `#N` placeholder in the template and also used in the `AskUserQuestion` preview header
- If non-numeric or absent: issue number = none; omit the `#N` line; `### Related Issue` = "N/A"
- This replaces the current step 10 instruction to "extract from branch name" — make it explicit and conditional

**Patterns to follow:**
- `pr-template.md` existing issue extraction documentation
- `skills/branch/SKILL.md` for branch naming convention reference

**Test scenarios:**
- `feat/99/my-feature` → issue number = 99
- `feat/no-ref/foo` → issue number = none
- `main-hotfix` (no slashes) → issue number = none
- `feat/abc/foo` (non-numeric) → issue number = none

**Verification:**
- PR body for `feat/99/my-feature` contains `#99` near the top and `owner/repo#99` in the Related Issue section

---

- [ ] **Unit 5: Add confirmation preview via `AskUserQuestion` before PR creation**

**Goal:** Show the full PR draft to the user and allow confirm, cancel, or revise before `gh pr create` runs.

**Requirements:** R2, R3, R4.

**Dependencies:** Unit 1, Unit 4.

**Files:**
- Modify: `skills/ship/SKILL.md` (Phase 3 — new PR path, between push and `gh pr create`)

**Approach:**
- After pushing the branch, generate the PR title and body (using the template + issue number from Unit 4)
- Use `AskUserQuestion` with a single question. Set the `preview` field on the Confirm option to display:
  ```
  Title: <title>
  Branch: <branch> → main
  Issue: #<N>  (or "No issue" if none)

  <full PR body>
  ```
- Options: **Confirm** (create PR as shown), **Cancel** (stop), **Other** (automatic — revision notes)
- On Confirm: proceed to `gh pr create` with the confirmed title and body
- On Cancel: output "PR creation cancelled. Branch has been pushed." and stop
- On Other: treat the free-form input as a revised title and/or body revision notes, regenerate title and body accordingly, re-show the preview (loop)
- Preview loop has no hard iteration cap — regenerate until user confirms or cancels

**Patterns to follow:**
- `skills/issue-from-context/SKILL.md` step 5a — exact pattern to mirror, including the `preview` field on the Confirm option and the Other-as-revision-notes loop

**Test scenarios:**
- User confirms on first preview → PR created with shown title and body
- User cancels → no PR created, branch is pushed, informative message
- User provides revision notes via Other → preview regenerated with revised content and re-shown
- User provides a new title via Other → title updated, body unchanged or revised, preview re-shown
- `AskUserQuestion` loop runs twice before confirm → correct final title and body used in `gh pr create`

**Verification:**
- `gh pr create` is never called without the user having explicitly confirmed the preview
- Cancelled flow leaves the branch in the remote but creates no PR

## System-Wide Impact

- **`disable-model-invocation` removal:** This flag was likely set to make `/ship` faster or deterministic. Removing it allows the harness to invoke the model for `AskUserQuestion` interactions. No other skills are affected.
- **Existing-PR path:** The skill now has two diverging terminal states (new PR created vs. comment added to existing PR). Both paths push first, so no partial-push risk. The comment path is additive and non-destructive.
- **Issue linking:** The bare `#N` change is additive — it adds a mention to the issue timeline but changes nothing about the issue or PR state.
- **Integration coverage:** The confirmation preview loop means `gh pr create` is only called once per `/ship` invocation (after confirmation). There's no risk of duplicate PR creation from the loop itself.

## Risks & Dependencies

- **`disable-model-invocation` side effects:** Unknown why this flag was originally set. If it was needed for deterministic behavior in some pipeline context, removing it could change that. Low risk given no CI pipeline uses `/ship`.
- **`gh pr view` state edge cases:** A closed or merged PR on the same branch should not be treated as "PR exists" — the update path should only trigger for open PRs. The `--json state` field handles this, but the implementation must filter on `state == "OPEN"`.
- **Branch not yet pushed (first push in existing-PR check):** If `origin/<branch>` doesn't exist yet, `git log origin/<branch>..HEAD` will error. Push must happen before the diff commands in the update path. The design already handles this (push → then diff), but the implementer should verify ordering.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-29-ship-skill-improvements-requirements.md](docs/brainstorms/2026-04-29-ship-skill-improvements-requirements.md)
- Related code: `skills/ship/SKILL.md`, `skills/ship/pr-template.md`
- Pattern reference: `skills/issue-from-context/SKILL.md` (step 5a — AskUserQuestion preview loop)
- Pattern reference: `skills/branch/SKILL.md` (branch naming convention)
- External: [GitHub Docs — Linking a PR to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)
