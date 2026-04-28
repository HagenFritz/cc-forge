---
title: "feat: Add /initiative skill for living high-level initiative docs"
type: feat
status: active
date: 2026-04-28
issue: 10
---

# feat: Add /initiative skill for living high-level initiative docs

## Overview

Add a new `/initiative` skill that authors and maintains a high-altitude *living* initiative document at `docs/initiatives/YYYY-MM-DD-NNN-<slug>-initiative.md`. It is a sibling to `/plan`, but operates one level up: workstreams and milestones rather than commit-sized implementation units.

The defining feature is **two-mode invocation**:
- **Author mode** (no path argument): draft a new initiative doc.
- **Resume mode** (path argument): read the existing doc, gather evidence of work since the last update (commits, new sub-plans, closed PRs/issues), propose updates, and write back — preserving completed checkboxes and appending to a chronological progress log.

This makes the document a durable record of what was accomplished and lets a fresh agent resume the initiative cold after a compaction by reading just the file.

## Problem Frame

Today the workflow has:
- `/plan` — implementer-ready plan for one feature/bug. Mostly write-once.
- `/create-initiative` — one-shot publish of a parent initiative issue + sub-issues to GitHub. The doc it generates is shallow and not designed to be lived in.

There is no skill for authoring and maintaining a strategic-altitude document over the life of a multi-feature effort. The user wants:

1. A doc that tracks **concrete steps** of an initiative without bloating agent context.
2. **Compaction survival**: after `/compact`, a fresh session can resume by reading the doc.
3. **Living record**: the doc accrues references to brainstorms, plans, files edited, commits, and PRs as work happens. The user wants to "write back" to it.
4. The write-back is initiated by re-invoking the skill with the doc path — so the skill itself sees the doc and updates it.

## Requirements Trace

- R1. New skill at `skills/initiative/SKILL.md`, invoked via `/initiative`.
- R2. Stays separate from `/create-initiative` — no rename, no merge.
- R3. Writes/updates `docs/initiatives/YYYY-MM-DD-NNN-<slug>-initiative.md`, mirroring `/plan` naming.
- R4. Two modes: **author** (no path arg) and **resume** (path arg).
- R5. Resume mode preserves completed checkboxes and appends to a chronological progress log rather than rewriting the doc.
- R6. Compaction-survival: a reader who has only the file must understand the initiative's intent, current state, and recent decisions.
- R7. Cross-references downward: each workstream links to the brainstorm/plan/issue/PR it spawned.
- R8. Each write-back grounds its updates in real repo evidence (git log, new sub-plans, GitHub state) rather than the user's word alone.
- R9. Handoff options on completion: open in editor, run `/create-initiative` to publish to GitHub, start `/plan` on the first/next workstream.

## Scope Boundaries

- Not creating GitHub issues — that remains `/create-initiative`'s job. Optional handoff is offered.
- Not running implementation — that's `/work`.
- Not authoring per-step plans — each workstream hands off to `/plan` when its time comes.
- No external research phase. Initiatives are usually shaped by product/strategic intent. Research belongs to the per-step `/plan` invocations.
- Not auto-detecting closed PRs/issues across the entire repo — only those clearly tied to the initiative (linked from the doc, parent issue if known, or matched by branch/commit conventions).
- Not handling multi-repo initiatives in v1.

## Context & Research

### Relevant Code and Patterns

- `skills/plan/SKILL.md` — canonical reference for skill structure, phase ordering, frontmatter conventions, file-naming, and post-generation handoff. Mirror its structure where applicable.
- `skills/create-initiative/SKILL.md` — adjacent skill. The new skill must stay distinct in purpose; cross-link in handoff options.
- `skills/brainstorm/SKILL.md` — upstream of `/plan`. The new skill should similarly accept a brainstorm doc as optional origin.
- `AGENTS.md` — describes the workflow chain and skill conventions; the new skill is added under "GitHub Integration" or a new "Strategic" grouping.
- File-naming convention from `/plan`: `docs/plans/YYYY-MM-DD-NNN-<type>-<slug>-plan.md`. Mirror as `docs/initiatives/YYYY-MM-DD-NNN-<slug>-initiative.md` (no `<type>` segment — initiatives are not feat/fix/refactor).
- Sub-agent reference syntax in skills: `cc-forge:<category>:<agent-name>`.

### Institutional Learnings

- No `docs/solutions/` entries yet in this repo, so no prior learnings to apply.

## Key Technical Decisions

- **Argument-driven mode detection.** If `$ARGUMENTS` resolves to an existing file under `docs/initiatives/`, enter resume mode; otherwise enter author mode. This matches the user's mental model ("use the skill again but with the initiative doc included") and avoids a separate `/update-initiative` slash command.
  - Resolution order: (1) literal path match, (2) glob match within `docs/initiatives/`, (3) fall back to author mode if argument is free-text framing.
  - If the argument is ambiguous (matches multiple initiatives), use `AskUserQuestion` to pick one.

- **Progress Log is the heart of the living record.** Append-only, reverse-chronological, dated entries. Every write-back must produce at least one Progress Log entry, even when the primary edit happens elsewhere (e.g., toggling a workstream complete also logs "Workstream 2 completed — PR #14, commits abc123..def456").

- **Evidence-grounded updates in resume mode.** The skill must not just transcribe what the user says. It runs:
  - `git log --since=<last_updated>` for commits.
  - `ls docs/plans/ docs/brainstorms/` filtered by mtime > `last_updated` for new sub-docs.
  - `gh pr list --search` and `gh issue list` for closed work tied to the initiative (linked from the doc, or matched by branch prefix if a parent issue is recorded in frontmatter).
  This evidence is presented alongside the user's framing in a single review prompt.

- **Current State summary is regenerated on every update.** A 1–3 paragraph narrative ("Where we are, what just shipped, what's next") that lives near the top. Critical for compaction-survival — it loads first when a new agent reads the file.

- **Frontmatter records `last_updated` and optionally `parent_issue`.** `last_updated` is the watermark for evidence-gathering. `parent_issue: HagenFritz/cc-forge#42` is set if the user later runs `/create-initiative` from this doc.

- **No `<type>` segment in the filename.** Initiatives are strategic; `feat/fix/refactor` doesn't fit. Pattern: `docs/initiatives/YYYY-MM-DD-NNN-<slug>-initiative.md`.

- **Workstreams, not implementation units.** Each is potentially weeks of work and likely spawns its own `/plan`. Surface area is described by directory or component, not exact file paths.

- **No external research phase.** Differs from `/plan`. Research belongs in the downstream `/plan` invocations per workstream. The skill skips Phase 1.2/1.3 entirely.

## Open Questions

### Resolved During Planning

- Q: How does the skill "see" the included link to write back? **A:** Argument-driven — the skill takes the initiative path as `$ARGUMENTS`. No magic conversation-scanning required, though it's offered as a fallback convenience.
- Q: Should this replace `/create-initiative`? **A:** No. `/create-initiative` is one-shot GitHub publish; `/initiative` is the doc-authoring/maintenance loop. They compose: author with `/initiative`, optionally publish with `/create-initiative` later.
- Q: Should the skill modify the doc in place or write a new versioned file? **A:** Modify in place. The Progress Log preserves history; git provides the audit trail. Versioned files would fragment the "living record."
- Q: Append vs. rewrite in resume mode? **A:** Surgical edits — toggle checkboxes, append progress log entries, add cross-references, update Current State and `last_updated`. Strategic sections (problem frame, decisions) only change when the user explicitly amends them, and amendments are logged.

### Deferred to Implementation

- Exact prompt wording for the resume-mode review (`AskUserQuestion` preview content). Will be tuned during implementation against real example docs.
- Whether to detect and link "side-quest" entries (`/side-quest` skill) into the Open Threads section automatically. Plausible but adds coupling — defer.
- Whether to support partial updates via a third `[message]` argument (`/initiative <path> "shipped workstream 2"`) as a quick-log shortcut. Nice-to-have, not v1.
- Exact heuristics for matching commits/PRs to specific workstreams (branch-name prefix? commit-message scan? user confirmation?). Start with "show all evidence, let user assign" — refine later.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Mode dispatch

```
/initiative [arg]
   |
   +-- arg empty?  ─── yes ──> Author Mode
   |
   +-- arg resolves to docs/initiatives/*.md?  ─── yes ──> Resume Mode (read doc, gather evidence, propose updates)
   |
   +-- arg is a slug fragment matching one initiative?  ─── yes ──> Resume Mode
   |
   +-- arg matches multiple initiatives?  ─── ask AskUserQuestion to disambiguate
   |
   +-- otherwise (free-text framing)  ─── Author Mode (use arg as framing)
```

### Author Mode phases

```
0. Optional: find upstream brainstorm in docs/brainstorms/
1. Gather product/strategic context (one or two AskUserQuestion rounds)
2. Identify workstreams — coarse, dependency-ordered
3. Write doc with Current State, Workstreams, empty Progress Log
4. Handoff: open in editor / /create-initiative / /plan on first workstream
```

### Resume Mode phases

```
0. Read existing initiative doc fully (it is the source of truth)
1. Gather evidence:
     - git log since `last_updated`
     - new files in docs/plans/, docs/brainstorms/
     - gh pr/issue activity tied to this initiative
2. Synthesize proposed update:
     - Workstream checkboxes to toggle
     - New cross-references to attach to workstreams
     - New Progress Log entry (one or more)
     - Updated Current State narrative
     - New Open Threads, resolved Open Threads
3. Show user a single AskUserQuestion preview with the diff
4. On confirm: write surgical edits in place, bump `last_updated`
5. Handoff: continue working / /plan on next workstream / publish via /create-initiative
```

### Document anatomy (compaction-survival shape)

The doc is structured so a fresh agent reading top-to-bottom builds intent before mechanics:

```
Frontmatter (status, dates, parent_issue)
  ↓
Overview + Problem Frame      (why this initiative exists)
  ↓
Goals & Non-Goals             (scope rails)
  ↓
Strategic Decisions           (decisions made, with rationale)
  ↓
Current State (regenerated)   (one paragraph: where we are right now)
  ↓
Workstreams (checkbox list)   (what's done, what's next, with links)
  ↓
Progress Log (newest first)   (chronological narrative of work)
  ↓
Open Threads / Risks          (what's still loose)
  ↓
Sources & References          (origin docs, parent issue, related)
```

## Implementation Units

- [ ] **Unit 1: Scaffold the skill file and frontmatter**

**Goal:** Create `skills/initiative/SKILL.md` with name, description, argument-hint, and the high-level skeleton (phases 0–5) so the slash command is registered and discoverable.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Create: `skills/initiative/SKILL.md`
- Modify: `AGENTS.md` (add `/initiative` to the skills list with a one-line description)

**Approach:**
- Mirror the frontmatter shape of `skills/plan/SKILL.md` (`name`, `description`, `argument-hint`).
- `argument-hint`: `"[optional path to existing initiative doc, or framing for new initiative]"`.
- Description should make it clear when to invoke vs. `/plan` and vs. `/create-initiative`. Trigger phrases: "start an initiative", "track this initiative", "log progress on the initiative", "update the initiative doc".
- Add a section in `AGENTS.md` called "Strategic" or extend the existing list — `/initiative` is workflow-level, not just GitHub.

**Patterns to follow:**
- `skills/plan/SKILL.md` frontmatter and overall section ordering.
- `skills/brainstorm/SKILL.md` for upstream/origin-doc handling conventions.

**Verification:**
- `/initiative` appears in the available-skills list.
- `AGENTS.md` lists the new skill alongside its siblings.

- [ ] **Unit 2: Implement Mode Dispatch (Phase 0)**

**Goal:** Resolve `$ARGUMENTS` to either Author Mode or Resume Mode, with disambiguation when needed.

**Requirements:** R4

**Dependencies:** Unit 1

**Files:**
- Modify: `skills/initiative/SKILL.md`

**Approach:**
- Phase 0.1: Empty argument → Author Mode.
- Phase 0.2: Argument is an existing path under `docs/initiatives/` → Resume Mode with that path.
- Phase 0.3: Argument is a slug fragment (e.g., `auth-rewrite`) → glob `docs/initiatives/*<fragment>*-initiative.md`. Single match → Resume. Multiple matches → `AskUserQuestion` with the list. Zero matches → fall through.
- Phase 0.4: Otherwise treat the argument as free-text framing for Author Mode.
- Phase 0.5 (optional convenience): If no argument but the conversation context already includes an `docs/initiatives/...` path, surface it and ask whether to use it. Do not depend on this — it's brittle.

**Patterns to follow:**
- `skills/plan/SKILL.md` Phase 0 ("Resume, Source, and Scope") for the disambiguation pattern.

**Test scenarios:**
- No argument → Author Mode.
- Full path to existing initiative → Resume Mode, doc loaded.
- Slug fragment matching one initiative → Resume Mode.
- Slug fragment matching two initiatives → user is asked which.
- Fragment matching nothing, but reads as free-text → Author Mode with framing.

**Verification:**
- All five scenarios above route correctly.
- The chosen mode is announced to the user before the skill proceeds.

- [ ] **Unit 3: Author Mode — interview, structure, and write the new doc**

**Goal:** Produce a complete initial initiative doc from a fresh invocation, optionally seeded by an upstream brainstorm.

**Requirements:** R1, R3, R6, R7

**Dependencies:** Unit 2

**Files:**
- Modify: `skills/initiative/SKILL.md`
- Affects: `docs/initiatives/` (the skill creates this dir on first use)

**Approach:**
- Phase 1: Search `docs/brainstorms/` for a relevant upstream document. If found, read it and use it as origin (mirror `/plan` Phase 0.2–0.3).
- Phase 2: Strategic interview — only when needed. Ask 2–4 high-leverage questions: scope boundary, success criteria, known workstream shape, stakeholder/audience. Use `AskUserQuestion` with concise options where natural.
- Phase 3: Identify workstreams. Coarse-grained (each potentially its own `/plan`). Order by dependency. Each workstream has: name, goal, surface area (directory/component, not file paths), dependencies, success criteria, links (empty initially), status.
- Phase 4: Write the doc using the **Initiative Document Template** (see Unit 6).
- Phase 5: Filename: `docs/initiatives/YYYY-MM-DD-NNN-<slug>-initiative.md`. Sequence number determined by scanning today's existing files in `docs/initiatives/`.
- Phase 6: Confirm write, then offer post-generation options.

**Patterns to follow:**
- `skills/plan/SKILL.md` Phase 1 (gather context, but skip external research).
- `skills/plan/SKILL.md` Phase 5.2 (write file convention) and Phase 5.3 (post-generation options).

**Test scenarios:**
- Author with no upstream brainstorm — interview drives content.
- Author with an upstream brainstorm — origin is referenced and decisions carried forward.
- Author with sequence collision — second initiative on the same day gets `-002-`.

**Verification:**
- A new file is written at the expected path with all required sections present.
- `last_updated` and `date` in frontmatter are today's date.
- Workstreams have checkboxes and are dependency-ordered.

- [ ] **Unit 4: Resume Mode — evidence gathering**

**Goal:** When invoked on an existing doc, collect repo evidence of work since `last_updated` so updates are grounded in reality.

**Requirements:** R5, R8

**Dependencies:** Unit 2

**Files:**
- Modify: `skills/initiative/SKILL.md`

**Approach:**
- Read the entire initiative doc first. It is the source of truth — the agent may have no other context.
- Extract `last_updated`, `parent_issue` (if any), workstream surface areas, and current Open Threads from the doc.
- Run evidence queries:
  - `git log --since="<last_updated>" --oneline` for commits.
  - `ls -lt docs/plans/ docs/brainstorms/` filtered to entries newer than `last_updated`.
  - If `parent_issue` is set: `gh issue view <num> --comments` and `gh pr list --search "linked:<num>"` for activity.
  - If `parent_issue` is unset but the doc has links to specific PRs/issues, refresh their state with `gh pr view` / `gh issue view`.
- Present the gathered evidence to the user via `AskUserQuestion` preview before proposing updates. The user can amend or add framing.
- If the user provided extra context as a free-text argument or in conversation (e.g., "we just merged the auth refactor"), incorporate it.

**Patterns to follow:**
- `skills/create-issue-from-context/SKILL.md` — pattern for combining git signals with conversation context.

**Test scenarios:**
- Three commits since `last_updated`, no new sub-plans → evidence summary lists commits only.
- New brainstorm and new plan exist → evidence flags them as candidates to attach to specific workstreams.
- `parent_issue` set with closed PR → PR is surfaced as evidence with link.
- `last_updated` is today and nothing new → skill says "no new evidence; what would you like to update?" and proceeds with user-supplied context only.

**Verification:**
- Evidence list is visible to the user and shows commits/files/PRs with timestamps.
- Nothing in the existing doc is dropped or rewritten as a side effect of evidence gathering.

- [ ] **Unit 5: Resume Mode — propose, confirm, write back**

**Goal:** Synthesize a proposed update from evidence + user input, show a diff-style preview, and apply surgical edits in place.

**Requirements:** R5, R6, R7, R8

**Dependencies:** Unit 4

**Files:**
- Modify: `skills/initiative/SKILL.md`

**Approach:**
- Synthesize the proposed update:
  - Which workstream checkboxes to toggle.
  - Cross-references to attach to specific workstreams (commit hashes, PR numbers, plan paths).
  - One or more Progress Log entries (newest first) — each dated, with a one-paragraph narrative referencing the evidence.
  - A regenerated Current State paragraph reflecting the new state.
  - Open Threads to add or mark resolved.
  - Optional Strategic Decision amendment if the user explicitly changed direction (logged as a dated decision update).
- Show the proposal in `AskUserQuestion` with a `preview` field containing the proposed diff or new sections. Options: Confirm / Edit (free-text via Other) / Cancel.
- On confirm:
  - Edit the file surgically using the Edit tool — do not rewrite the whole document.
  - Toggle `[ ]` → `[x]` for completed workstreams.
  - Append to the Progress Log (insert at top of the section, since it's reverse-chronological).
  - Replace the Current State paragraph.
  - Update `last_updated` in frontmatter to today.
- Confirm with: `Initiative updated: docs/initiatives/<filename>`.

**Execution note:** Surgical edits are essential. A full rewrite would clobber any manual edits the user made between sessions and would make the git diff unreviewable.

**Patterns to follow:**
- `skills/plan/SKILL.md` Phase 5 — final review + write pattern.
- The Edit tool's exact-match contract — anchor edits on stable text near the change site.

**Test scenarios:**
- Toggle one workstream complete + add one Progress Log entry → existing content unchanged elsewhere.
- Add a new Open Thread without toggling any workstream → Progress Log still gets an entry ("Open thread added: …").
- User edits the proposed update via Other → revised proposal re-shown for confirmation.
- User cancels → no file modification.

**Verification:**
- `git diff` on the initiative file shows only the intended surgical changes.
- `last_updated` is bumped on every successful write-back.
- The Progress Log gains exactly one entry per write-back session (or more if the user explicitly logged separate events).

- [ ] **Unit 6: Initiative Document Template**

**Goal:** Define and embed the canonical template inside `SKILL.md` so both modes write/update consistently.

**Requirements:** R3, R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `skills/initiative/SKILL.md`

**Approach:**
The template ordering is intentional — the doc is read top-to-bottom by a fresh agent after compaction, so intent loads before mechanics. Sketch:

```markdown
---
title: <Initiative Title>
status: active   # active | paused | completed | archived
date: YYYY-MM-DD
last_updated: YYYY-MM-DD
origin: docs/brainstorms/...     # optional
parent_issue: owner/repo#NNN     # optional, set if published via /create-initiative
---

# <Initiative Title>

## Overview
<one paragraph: what this initiative is>

## Problem Frame
<why it exists, what problem it solves>

## Goals & Non-Goals
- Goal: ...
- Non-goal: ...

## Strategic Decisions
- Decision: <decision> — Rationale: <why> — Date: YYYY-MM-DD
  - Amendment YYYY-MM-DD: <if changed later>

## Current State
<1–3 paragraphs, regenerated on each update. Where we are right now.>

## Workstreams
- [ ] **W1: <name>**
  - Goal: ...
  - Surface area: <directory/component>
  - Dependencies: <none | W0 | external>
  - Success criteria: ...
  - Links: <plan/brainstorm/PR/issue refs as work progresses>
  - Status notes: <short>
- [ ] **W2: <name>**
  ...

## Progress Log
<newest first>

### YYYY-MM-DD
- <what happened, with refs to commits / PRs / plans>

## Open Threads
- <thing not yet resolved>

## Risks
- <risk> — Mitigation: ...

## Sources & References
- Origin: <brainstorm path if any>
- Parent issue: <link if any>
- Related: <plans, PRs, external refs>
```

**Patterns to follow:**
- `/plan`'s template embedding style — the template lives inside SKILL.md as a fenced block.

**Verification:**
- Both Author and Resume modes produce/preserve the same section ordering.
- Newly authored docs validate against this template.

- [ ] **Unit 7: Post-generation handoff options**

**Goal:** After write (either mode), offer the right next steps without forcing the user to remember sibling skills.

**Requirements:** R9

**Dependencies:** Units 3, 5

**Files:**
- Modify: `skills/initiative/SKILL.md`

**Approach:**
- Use `AskUserQuestion` with options that adapt by mode:
  - Author mode just finished: Open in editor / Start `/plan` on Workstream 1 / Publish parent issue with `/create-initiative` / Done.
  - Resume mode just finished: Open in editor / Start `/plan` on next pending workstream / Mark initiative complete (sets frontmatter `status: completed`) / Done.
- "Start `/plan` on Workstream N" hands off the workstream's goal + surface area + success criteria as the planning input.
- Mark-complete sets `status: completed`, regenerates Current State as a final summary, and adds a final Progress Log entry.

**Patterns to follow:**
- `/plan` Phase 5.3 post-generation options.

**Test scenarios:**
- Choose `/plan` on next workstream → `/plan` is invoked with the workstream framing.
- Choose mark-complete → frontmatter and final summary update; subsequent Resume invocations are still possible but warn that the initiative is closed.

**Verification:**
- All offered options route correctly to their target skills or modifications.
- Done/no-op exits cleanly without spurious file writes.

## System-Wide Impact

- **Interaction graph:** `/initiative` (Author) → optionally `/create-initiative` (publish) → optionally `/plan` per workstream → `/work`. `/initiative` (Resume) sits at the top of that loop and is invoked between cycles.
- **Error propagation:** Resume mode reads-then-writes. If the doc is malformed (bad frontmatter, missing sections), the skill must fail gracefully — surface the parse issue and ask whether to repair or abort. Never silently rewrite in a way that loses the existing record.
- **State lifecycle risks:** The doc *is* the state. A botched surgical edit could corrupt the only record. Mitigations: (a) always show the proposed diff before writing; (b) prefer Edit over Write for in-place updates; (c) git provides the recovery path — assume the user works in a tracked repo.
- **API surface parity:** `/create-initiative` produces a thin parallel artifact (the GitHub issue). When `/initiative` runs after `/create-initiative`, it should pick up the parent issue and adopt it as `parent_issue` in frontmatter. Worth a small follow-up but not v1-blocking.
- **Integration coverage:** End-to-end scenario worth walking through manually before declaring done — author a fake initiative, write a commit referencing it, run resume, verify the Progress Log captures the commit and the workstream toggles.

## Risks & Dependencies

- **Risk: surgical-edit fragility.** Edit tool requires exact string match; if section formatting drifts (extra newline, different bullet style), edits silently fail to find anchors. Mitigation: anchor edits on frontmatter keys and section headers, which are stable. Consider a doc-validation pre-flight in resume mode.
- **Risk: evidence-gathering false positives.** A commit since `last_updated` might be unrelated to the initiative. Mitigation: present evidence as candidates, let the user assign or discard. Don't auto-attach.
- **Risk: feature creep.** Tempting to add side-quest auto-linking, multi-repo support, automatic PR detection by branch convention. Defer all of these — the v1 invariant is "doc is durable, two modes work, write-back is grounded."
- **Risk: confusion with `/create-initiative`.** Mitigation: clear description text on each skill, explicit cross-link in handoff options, and an explanatory note in `AGENTS.md`.
- **Dependency:** No new external tools. Uses the same `gh`, `git`, file-system stack already used by sibling skills.

## Documentation / Operational Notes

- Update `AGENTS.md` to list `/initiative` and clarify its relationship to `/plan` (one altitude up) and `/create-initiative` (publishing, not authoring).
- Add a 2–3 line example in `AGENTS.md` showing the typical flow: `/initiative` → `/plan` per workstream → `/work` → `/initiative <path>` to log progress.
- Consider a `docs/initiatives/README.md` once a few initiatives exist, to summarize active vs. completed. Not v1.

## Sources & References

- Origin issue: `HagenFritz/cc-forge#10`
- Sibling skill (canonical structural reference): `skills/plan/SKILL.md`
- Sibling skill (related but distinct purpose): `skills/create-initiative/SKILL.md`
- Upstream skill: `skills/brainstorm/SKILL.md`
- Project conventions: `AGENTS.md`
