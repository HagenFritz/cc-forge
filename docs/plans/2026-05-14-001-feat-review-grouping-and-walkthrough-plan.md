---
title: "feat: Review doc enrichment + guided walkthrough skill"
type: feat
status: completed
date: 2026-05-14
origin: docs/brainstorms/2026-05-14-review-grouping-and-walkthrough-requirements.md
---

# feat: Review doc enrichment + guided walkthrough skill

## Overview

Two-part change to the code-review workflow in this plugin:

1. **Enrich `/review` output** — every issue gets `Category`, `Confidence` (+ rationale), and `Plain English` fields; the doc gains a top-level `## Groups` section that clusters related issues across P-levels with cascade notes.
2. **New `/review-walk` skill** — invoked once with a review doc path, walks the user group-by-group with a plain-English teach-moment per group, then through member issues with **implement / defer / skip / explain more** actions, updating `Status:` inline in the doc so progress is durable and resumable.

This replaces the user's manual workflow of compacting the conversation, switching models, and stepping through P1/P2/P3 lists in isolation.

## Problem Frame

See origin: `docs/brainstorms/2026-05-14-review-grouping-and-walkthrough-requirements.md`. The current review doc lists issues by P-level only, so cross-P cascades are missed, some issues go over the user's head (leading to blind acceptance), and low-confidence noise is indistinguishable from real findings. The user's manual execution loop is slow and unstructured.

## Requirements Trace

Origin doc requirements:

- **R1** — Per-issue `Category:` field (8 fixed values)
- **R2** — Per-issue `Confidence:` + `Confidence rationale:`
- **R3** — Per-issue `Plain English:` field
- **R4** — Top-level `## Groups` section with name, member IDs, why grouped, suggested order, cascade
- **R5** — Grouping happens during synthesis, before doc is written
- **R6** — `/review-walk` invoked once, drives session via conversation context; auto-discovers latest review if no path given
- **R7** — Group-first walk: cluster summary → plain-English teach moment with code example → member issues in suggested order
- **R8** — Per-issue actions: implement / defer / skip / explain more
- **R9** — Update `Status:` inline (`in-progress`, `done`, `deferred`, `wont-fix`)
- **R10** — Low-confidence issues surfaced with clear noise marker
- **R11** — Defer captures a one-line reason in the doc
- **R12** — Resume: re-invoke `/review-walk <path>` picks up at first `open` issue

## Scope Boundaries

- Issues stay grouped by P-level in the main `## Issues` section. `## Groups` is additive.
- No second-pass "noise filter" agent — confidence is inline at finding-time.
- No changes to `/review`'s orchestration (parallel/serial agents, worktrees, PR setup).
- No `style` category.
- No new file format for deferred issues — they live in the review doc with `Status: deferred`.

## Context & Research

### Relevant Code and Patterns

- `skills/review/SKILL.md` — the skill being modified. Synthesis happens in Section 5 ("Findings Synthesis, Review Document, and Todo Creation"); the doc template lives there too.
- `skills/work/SKILL.md` — best existing model for a multi-turn skill that drives a session from a durable doc and resumes from checkbox/status state. `/review-walk` should mirror its "Read Plan and Clarify" → loop pattern.
- `skills/triage-issue/SKILL.md` and `skills/initiative/SKILL.md` — additional examples of skills that consume a doc, ask one-at-a-time questions, and update the doc inline.
- `skills/deprecate/SKILL.md` — clean example of skill frontmatter (`user-invocable`, `argument-hint`, `allowed-tools`) and a step-numbered flow.
- `src/claude.ts` — the install script copies `skills/<name>/` directories to `~/.claude/skills/`. A new skill just needs a new directory under `skills/`; no code changes required.

### Institutional Learnings

- The repo's `CLAUDE.md` is explicit that **changes are not live until `npm run build && node dist/cli.mjs install` runs**. This affects verification steps for both units.
- The review skill already has a "Protected Artifacts" section discarding findings that target `docs/brainstorms/`, `docs/plans/`, `docs/solutions/`. The walkthrough must respect the same list (never let a user accidentally mark such a finding for execution if one slipped through).

### External References

None — pure repo-internal work, well-patterned by neighboring skills.

## Key Technical Decisions

- **Two skills, two units, one PR-able plan.** Unit 1 lands the doc enrichment; Unit 2 builds the walkthrough. Walkthrough depends on the new fields, so Unit 1 ships first.
- **Synthesizing model owns grouping, categorization, and plain-English.** Not a separate agent pass. The synthesis step already has every finding in working memory after the parallel reviewers return; doing it there is one prompt, not an orchestration change. (See origin: deferred Q on R5.)
- **Confidence is set by the originating reviewer**, surfaced through synthesis. Synthesis adds the field structurally if a reviewer didn't supply one (defaulting to `medium` with rationale `"not stated by reviewer"`), so the doc shape is consistent regardless of agent behavior.
- **Doc-as-state.** `Status:` field per issue is the only progress store. No JSON sidecar, no SQLite. Resume = re-read doc, find first `Status: open`, continue.
- **Auto-discovery rule:** newest review doc by filename sort (date + zero-padded sequence are both in the name, so lexicographic sort is correct). Avoids `mtime` confusion when files are edited mid-walk. (See origin: deferred Q on R6.)
- **8 fixed categories**: `security`, `correctness`, `performance`, `architecture`, `duplication`, `maintainability`, `testing`, `docs`. Synthesis instructions enumerate them; reviewers don't need updating.
- **Group teach-moment re-reads cited files.** Walkthrough should `Read` the files cited in group issues before composing the plain-English explanation, so the example reflects current code rather than the reviewer's snapshot. (See origin: deferred Q on R7 — resolved here in favor of accuracy; cost is small, a handful of Read calls per group.)

## Open Questions

### Resolved During Planning

- **Grouping owner (origin Q on R5):** synthesizing model, in existing Step 1, via additional instructions in the template section of `skills/review/SKILL.md`. Rationale: simpler, no new agent, finding context is already loaded.
- **Auto-discovery (origin Q on R6):** lexicographic filename sort of `docs/reviews/*.md`, pick last. Filename convention guarantees correctness.
- **Teach-moment grounding (origin Q on R7):** re-read cited files when composing the group concept explanation. Accuracy outweighs the small token cost.
- **Status state machine (origin Q on R9):** `open` (initial) → `in-progress` (user picked implement, fix in flight) → `done` | `deferred` | `wont-fix`. The `Status:` line already exists in the template as an HTML-comment-annotated single field; edit-in-place with the `Edit` tool, anchored on the surrounding `### Pn-N:` heading + `**Status:**` line for uniqueness.

### Deferred to Implementation

- Exact prompt wording for synthesis to produce grouping + categories + confidence + plain-English in one pass. Best resolved by iterating against a real review doc during Unit 1.
- Whether `/review-walk` should offer a "summary mode" at the start (read whole doc, present groups overview before diving in) or jump straight into G1. Probably yes, but the exact UX shape is easier to decide while building.
- How to handle a review doc that predates Unit 1 (no `Category`/`Confidence`/`Groups` fields). Likely: `/review-walk` falls back to issue-by-issue ordering and skips the teach-moment. Decide at implementation time based on how much fallback code is worth.
- Whether `defer` should also write a side-quest entry via the existing `/side-quest` skill, or just inline the reason. Probably inline for now — adding side-quest integration is a follow-up.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Review doc shape after Unit 1** (additions shown; existing structure preserved):

```markdown
## Summary
| Priority | Count | Label | ... |
[unchanged]

## Groups                                    ← NEW top-level section

### G1: <name>
**Issues:** P1-1, P2-3, P3-2
**Why grouped:** <1-2 sentences>
**Suggested order:** P1-1 → P2-3 → P3-2
**Cascade:** Fixing P1-1 likely makes P3-2 moot; if P1-1 is fixed via approach B, revisit P2-3.

---

## Issues

### P1-1: <Short Title>
**Status:** `open`
**Category:** security                       ← NEW
**Confidence:** high                          ← NEW
**Confidence rationale:** Verified at ...     ← NEW
**File(s):** path/to/file.rb:42
**Plain English:** <1-3 sentences in non-jargon terms, grounded in the user's code> ← NEW
**Problem:** <existing>
**Fix:** <existing>
**Effort:** Small | Medium | Large
```

**`/review-walk` flow** (state lives entirely in the doc + conversation context):

```
invoke /review-walk [path?]
  → resolve doc path (arg or auto-discover newest in docs/reviews/)
  → read doc, parse groups + issues + statuses
  → if any issue has Status: in-progress, resume there
  → else find first group whose member issues are not all terminal
  → for each remaining group:
      present cluster summary
      Read cited files to ground the example
      explain concept in plain English
      for each member issue in Suggested order (skip terminal statuses):
        present issue (highlight Confidence: low with noise marker)
        ask: implement / defer / skip / explain more
        on implement:    set Status: in-progress → apply fix → set Status: done
        on defer:        ask one-line reason → set Status: deferred + reason field
        on skip:         set Status: wont-fix
        on explain more: deeper teaching, then re-ask
  → final summary: counts by status, suggest /ship or follow-ups
```

## Implementation Units

- [x] **Unit 1: Enrich `/review` synthesis output**

**Goal:** Update `skills/review/SKILL.md` so the synthesis step produces a richer review document that includes per-issue `Category`, `Confidence`, `Confidence rationale`, `Plain English` fields, plus a top-level `## Groups` section.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None.

**Files:**
- Modify: `skills/review/SKILL.md` — extend Section 5 ("Findings Synthesis, Review Document, and Todo Creation"), specifically:
  - Step 1 "Synthesize All Findings": add grouping, categorization, confidence-normalization, plain-English-composition tasks to the `<synthesis_tasks>` list.
  - Step 2 "Write Review File": update the markdown template to include the new per-issue fields and the `## Groups` section. Update the issue-writing rules.

**Approach:**
- Add a fixed category list inline in the SKILL: `security | correctness | performance | architecture | duplication | maintainability | testing | docs`.
- Define the confidence vocabulary inline: `high` (reviewer verified from code shown), `medium` (pattern match, not verified end-to-end), `low` (heuristic flag, likely needs human judgment).
- Plain-English rule: 1–3 sentences, must reference at least one concrete code location from the issue's `File(s):`. Forbid jargon-only descriptions.
- Grouping rule: form a group when ≥2 issues share a root cause, touch the same module/path cluster, or have an explicit fix-order dependency. Single-issue "groups" are not written. Groups can span P-levels.
- Cascade note is required for every group; if no cascade exists, write `Cascade: independent fixes — no ordering dependency.`
- Synthesis must default any missing `Confidence` to `medium` with rationale `not stated by reviewer` so the doc shape is uniform.

**Patterns to follow:**
- The existing Step 2 template structure in `skills/review/SKILL.md` (lines ~275–347) — keep the same heading hierarchy, fence style, and self-contained-issue principle. Add fields, don't restructure.
- The "Protected Artifacts" block style (boxed callout) for the new category-list and confidence-vocabulary definitions.

**Test scenarios:**
- Run `/review` against a small real PR or branch; verify the produced doc:
  - Has a `## Groups` section listing 0+ groups (0 is valid for tiny PRs).
  - Every issue has all four new fields, none missing.
  - At least one issue with a verifiable code reference has `Confidence: high`.
  - Plain English passes the "non-jargon reference" check (mentions a file/line and avoids review-speak like "N+1 anti-pattern" without a follow-up explanation).
- Edge case: a PR with only one finding — `## Groups` section is present but empty (with a `_None._` placeholder or omitted; pick one and document it in the template).
- Edge case: two reviewer agents flag the same issue — synthesis dedupes before grouping (existing behavior; verify still works).

**Verification:**
- Re-installing the plugin (`npm run build && node dist/cli.mjs install`) and re-running `/review` on a sample target produces a doc matching the new template.
- A spot read of the generated doc shows every issue has all four new fields and any group block carries the required sub-fields.

---

- [x] **Unit 2: New `/review-walk` skill**

**Goal:** Add a new user-invocable skill `skills/review-walk/SKILL.md` that consumes a review doc produced by Unit 1 and drives a guided, group-first walkthrough with inline `Status:` updates and resume support.

**Requirements:** R6, R7, R8, R9, R10, R11, R12

**Dependencies:** Unit 1 (the walkthrough relies on the new fields existing in the doc).

**Files:**
- Create: `skills/review-walk/SKILL.md` — the new skill.
- Modify: `CLAUDE.md` — add `/review-walk` to the Skills list under the core workflow grouping (next to `/review`).
- Modify: `.claude-plugin/plugin.json` (or equivalent skill manifest if present — verify at implementation time; if skills are auto-discovered from `skills/`, no manifest edit is needed).

**Approach:**
- Frontmatter mirrors `skills/deprecate/SKILL.md`: `name: review-walk`, `description`, `user-invocable: true`, `argument-hint: "[path to review doc]"`, `allowed-tools: Bash, Read, Edit, Agent`.
- Argument handling: if no path, auto-discover via `ls docs/reviews/*.md | sort | tail -1`. If none found, stop with a helpful message pointing to `/review`.
- Resume detection: parse the doc, find any issue with `Status: in-progress` first (resumes a mid-flight session); else find the first issue with `Status: open`.
- Group iteration: for each group with non-terminal members, present the group block, then `Read` each unique file path cited in its member issues' `File(s):` field, then compose the plain-English teach-moment grounded in the actual current code (not just the doc's snapshot).
- Per-issue prompt presents the four actions via `AskUserQuestion` (single-select). Low-confidence issues get a leading noise marker line: `Reviewer confidence is LOW (<rationale>). Likely safe to skip if it doesn't match your read of the code.`
- Status transitions use `Edit` on the doc, anchored on the `### Pn-N:` heading + `**Status:**` line for uniqueness. The skill writes:
  - `Status: in-progress` immediately when implement is chosen, before touching code (so a crash leaves clear state).
  - `Status: done` after the fix is applied.
  - `Status: deferred` + new `**Defer reason:**` line for defer.
  - `Status: wont-fix` for skip.
- For "explain more", the skill expands on the plain-English teach-moment with a deeper concept walkthrough, then re-asks the same four-action prompt.
- Orphaned issues (issues not in any group) walk after all groups are processed, issue-by-issue, with no teach-moment header.
- Fallback for pre-Unit-1 docs (no Groups / Plain English): detect by absence of `## Groups` heading; fall back to strict issue-by-issue order, skip teach-moments, but keep the four-action prompt and status updates.

**Patterns to follow:**
- `skills/work/SKILL.md` Phase 1 — read-the-plan-first, ask-clarifying-questions-once, then loop. Same posture.
- `skills/triage-issue/SKILL.md` — single-doc-driven flow with inline updates.
- `skills/initiative/SKILL.md` — resume-from-doc-state pattern.
- `skills/deprecate/SKILL.md` — frontmatter and step-numbered structure.

**Execution note:** Iterate the SKILL.md against a real review doc during development — read the skill output, run it mentally on a sample doc, refine the prompt wording. No automated tests; this is prompt engineering.

**Technical design:**

```
SKILL.md outline:
  # /review-walk
  ## Step 1: Resolve doc path
  ## Step 2: Read doc, parse state, decide entry point
  ## Step 3: Confirm session start with user (show doc summary)
  ## Step 4: Group loop
    4a. Present group block
    4b. Read cited files
    4c. Teach concept in plain English with concrete example
    4d. Issue loop within group
       - Present issue (with noise marker if low confidence)
       - Ask four-action question
       - Execute chosen action (with inline Status update)
  ## Step 5: Orphan issue loop
  ## Step 6: Final summary
  ## Status update protocol (shared subsection)
  ## Fallback for pre-enrichment docs
```

**Test scenarios:**
- Invoke `/review-walk` with no args on a repo that has multiple review docs → picks the lexicographically last one and starts.
- Invoke `/review-walk` on a doc where all issues are `done` → reports "Walkthrough already complete" and exits.
- Invoke with one issue marked `in-progress` → resumes there, not at the top.
- User picks `implement` on a P1 issue → doc shows `Status: in-progress`, fix is applied, doc shows `Status: done`.
- User picks `defer` → doc shows `Status: deferred` and a new `**Defer reason:** <text>` line.
- User picks `explain more` → deeper teaching, then re-prompts; doc state unchanged.
- A P3 issue with `Confidence: low` is presented with the noise marker prefix.
- Fallback: run the skill against an old review doc (no Groups, no Plain English) → walkthrough proceeds issue-by-issue, no teach-moments, status updates still work.

**Verification:**
- `npm run build && node dist/cli.mjs install` succeeds and copies the new skill to `~/.claude/skills/review-walk/`.
- `node dist/cli.mjs doctor` reports the new skill installed.
- After Claude Code restart, `/review-walk` appears in the available skills list and triggers on invocation.
- Walking a real review doc end-to-end leaves the doc in a coherent terminal state (every issue `done`, `deferred`, or `wont-fix`).

## System-Wide Impact

- **Interaction graph:** `/review` produces the doc; `/review-walk` consumes and mutates it. No other skill currently writes to `docs/reviews/`. `/ship` reads the working tree, not the review doc, so no conflict.
- **Error propagation:** If the user aborts mid-walk, the doc reflects last-committed state (any issue mid-implement is left at `Status: in-progress` with no spurious `done`). Resume picks up cleanly.
- **State lifecycle risks:** The only durable state is the `Status:` line. Edit-in-place anchored on the issue heading is unique enough to avoid collisions (P1-1 vs P2-1 etc.). If the user manually edits the doc between walk turns, the next read picks up their changes — that's a feature.
- **API surface parity:** None — this is a plugin-local change. The plugin's CLI (`src/claude.ts`) auto-discovers any directory under `skills/`, so the new skill ships with the next install.
- **Integration coverage:** Manual end-to-end walk of a real review is the integration test. No unit-test infrastructure for skills exists in this repo, by design.

## Risks & Dependencies

- **Risk: synthesis prompt drift.** Adding grouping + categorization + plain-English in one synthesis pass may make that step long. Mitigation: structure the instructions as a checklist in the SKILL.md so the model has explicit cues. If quality drops, split into two passes in a follow-up.
- **Risk: review docs written before Unit 1 will not match the new shape.** Mitigation: `/review-walk` has an explicit fallback path for pre-enrichment docs. Documented as a deferred-implementation question.
- **Risk: user installs only one of the two units.** The walkthrough's fallback path keeps it usable against old docs, but the teach-moments only land for new ones. Acceptable; documented.
- **Dependency: install step.** Per `CLAUDE.md`, neither unit is live until `npm run build && node dist/cli.mjs install` runs. Both units must include that step in their final verification.

## Documentation / Operational Notes

- Update `CLAUDE.md` Skills list to include `/review-walk`.
- The README (if it lists skills) should be checked at implementation time; update if present.
- No migration needed for existing `docs/reviews/*.md` files — they continue to work via the walkthrough's fallback path.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-14-review-grouping-and-walkthrough-requirements.md](../brainstorms/2026-05-14-review-grouping-and-walkthrough-requirements.md)
- Skill being modified: `skills/review/SKILL.md`
- Skill patterns to mirror: `skills/work/SKILL.md`, `skills/triage-issue/SKILL.md`, `skills/initiative/SKILL.md`, `skills/deprecate/SKILL.md`
- Install pipeline: `src/claude.ts`
- Project conventions: `CLAUDE.md`
