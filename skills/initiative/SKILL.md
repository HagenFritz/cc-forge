---
name: initiative
description: "Author and maintain a high-altitude living initiative document at docs/initiatives/. Sibling to /plan but one altitude up — workstreams and milestones rather than commit-sized units. The doc is the durable record of a multi-feature effort: it survives compaction (a fresh agent can resume by reading the file) and accrues progress over time. Two modes: invoke with no path to **author** a new initiative, or invoke with the path to an existing initiative doc to **resume** — the skill gathers evidence (commits, new sub-plans, PR/issue activity) since last_updated and writes the update back into the doc surgically. Use when the user says 'start an initiative', 'track this initiative', 'log progress on the initiative', 'update the initiative doc', or hands you the path to an existing initiative file."
argument-hint: "[optional path/slug of existing initiative doc, OR free-text framing for a new initiative]"
---

# Author or Maintain a Living Initiative Document

**Note: The current year is 2026.** Use this when dating initiative docs and progress log entries.

`brainstorm` defines **WHAT** to build. `plan` defines **HOW** to build one feature. `initiative` coordinates a **multi-feature effort** at one altitude up — and stays alive across the life of that effort.

This workflow produces or updates a durable initiative document at `docs/initiatives/`. It does **not** implement code, run tests, or learn from execution-time results. Each workstream typically hands off to `/plan` when its time comes; `/work` then executes that plan; the user re-invokes `/initiative <path>` afterward to log progress back.

`/initiative` does **not** publish to GitHub — that's `/create-initiative`'s job. The two skills compose: author with `/initiative`, optionally publish with `/create-initiative` later, and `parent_issue` is recorded in frontmatter so subsequent resumes can pull issue/PR state.

## Interaction Method

Use the platform's question tool when available. When asking the user a question, prefer the platform's blocking question tool if one exists (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). Otherwise, present numbered options in chat and wait for the user's reply before proceeding.

Ask one question at a time. Prefer concise single-select choices when natural options exist. Use the `preview` field on `AskUserQuestion` options when showing proposed doc changes the user needs to compare against current state.

## Argument

<argument> #$ARGUMENTS </argument>

## Core Principles

1. **The document is the state.** A botched edit corrupts the only record. Always preview proposed changes before writing. Prefer surgical Edit over full Write in resume mode.
2. **Compaction-survival is a design constraint.** A reader who has only the file must understand intent before mechanics. Section ordering reflects this: Overview → Problem Frame → Goals → Strategic Decisions → Current State → Workstreams → Progress Log → Open Threads → Risks → Sources.
3. **Living record, not a snapshot.** The Progress Log is append-only and reverse-chronological. Every successful write-back produces at least one Progress Log entry, even when the primary edit was elsewhere.
4. **Evidence-grounded updates.** In resume mode, don't transcribe what the user says — collect repo evidence (commits, new sub-plans, PR/issue activity) and present it alongside their framing before writing.
5. **High altitude.** Workstreams are coarse-grained — each is potentially weeks of work and likely spawns its own `/plan`. Surface area is described by directory or component, not exact file paths.
6. **Stay separate from `/create-initiative`.** That skill publishes; this one authors and maintains. Cross-link in handoff options. Adopt `parent_issue` if it's already been published.
7. **No external research phase.** Initiatives are shaped by product/strategic intent. Research belongs to the per-step `/plan` invocations.

## Workflow

### Phase 0: Mode Dispatch

Resolve the argument to either **Author Mode** (drafting a new initiative) or **Resume Mode** (updating an existing one).

#### 0.1 Resolution Order

1. **Argument empty** → Author Mode. Skip to Phase A1.
2. **Argument is an existing path under `docs/initiatives/`** (with or without `.md`) → Resume Mode with that path. Skip to Phase R1.
3. **Argument is a slug fragment** — glob `docs/initiatives/*<fragment>*-initiative.md`:
   - **Single match** → Resume Mode with that path. Skip to Phase R1.
   - **Multiple matches** → use the platform's blocking question tool to disambiguate. Show each candidate's title and date.
   - **Zero matches** → fall through to step 4.
4. **Argument is free text that doesn't resolve to a file** → Author Mode. Carry the argument forward as initial framing.

Announce the chosen mode briefly before proceeding. Examples:
- "No initiative path supplied — entering Author Mode."
- "Resuming initiative at `docs/initiatives/2026-04-28-001-auth-rewrite-initiative.md`."

#### 0.2 Optional convenience: conversation-context fallback

If the argument is empty **and** the recent conversation context already references an initiative path under `docs/initiatives/`, you may surface it and ask whether to enter Resume Mode on that file. Do not depend on this; treat it as a convenience only.

---

## Author Mode

### Phase A1: Find Upstream Brainstorm

Search `docs/brainstorms/` for a relevant `*-requirements.md`. Relevance criteria mirror `/plan`:
- The topic semantically matches the initiative framing
- Created within the last 30 days (override with judgment if clearly still relevant or clearly stale)
- Covers the same problem or scope

If multiple candidates match, ask which one to use. If none match, proceed without an origin doc.

If a brainstorm is selected:
1. Read it thoroughly.
2. Announce: "Found origin brainstorm at <path>. Carrying decisions forward."
3. Carry forward problem frame, scope boundaries, key decisions, dependencies, and open questions.
4. Reference important carried-forward decisions in the initiative doc with `(see origin: <path>)`.

### Phase A2: Strategic Interview

Ask only the questions you need. Use the platform's blocking question tool. Targets:

1. **Initiative title and slug** (if not obvious from framing).
2. **Scope boundary** — what is explicitly *not* part of this initiative.
3. **Success criteria** — how the user will know the initiative is done.
4. **Workstream shape** — does the user already have a mental breakdown, or should you propose one?
5. **Stakeholder/audience** — who else cares about this initiative.

Skip any question whose answer is already clear from the brainstorm or argument framing.

### Phase A3: Identify Workstreams

Propose 3–6 workstreams. Each is coarse, dependency-ordered, and potentially its own `/plan`.

For each workstream, capture:
- **Name**
- **Goal** — one sentence
- **Surface area** — directory, component, or system, *not* file paths
- **Dependencies** — none, or W<n>, or external
- **Success criteria** — how this workstream is "done"
- **Links** — empty initially; populated as work progresses
- **Status notes** — short

If the user pushes back on the breakdown, iterate before writing.

### Phase A4: Determine Filename

Build the filename:
```
docs/initiatives/YYYY-MM-DD-NNN-<slug>-initiative.md
```
- Create `docs/initiatives/` if it does not exist.
- Scan today's existing files in `docs/initiatives/` to determine the next sequence number (zero-padded to 3 digits, starting at 001).
- Slug is concise (3–5 words), kebab-cased.
- No `<type>` segment — initiatives aren't feat/fix/refactor.

### Phase A5: Write the Doc

Use the **Initiative Document Template** below. Write the file using the Write tool.

Confirm:
```
Initiative written to docs/initiatives/<filename>
```

### Phase A6: Handoff

Offer the Author-mode post-generation options (see Phase H below).

---

## Resume Mode

### Phase R1: Read the Existing Doc

**This is non-optional and runs first.** The agent may have no other context after a compaction; the doc is the source of truth.

Read the entire file. Extract:
- `last_updated` (the watermark for evidence gathering)
- `parent_issue` if set
- `status` (warn the user if `completed` or `archived` and ask whether to continue)
- Workstream surface areas (used to scope evidence to relevant areas)
- Current Open Threads (so resolved ones can be detected)
- Existing Strategic Decisions (so amendments are clearly logged as amendments, not silent rewrites)

If the doc is malformed (missing frontmatter, missing required sections), surface the parse issue and ask whether to repair or abort. Never silently rewrite in a way that drops content.

### Phase R2: Gather Evidence

Run these in parallel where they're independent. Filter to entries since `last_updated`.

1. **Commits since last update:**
   ```bash
   git log --since="<last_updated>" --oneline --no-merges
   ```
   For commits whose message or branch hints at a specific workstream, note the workstream tag.

2. **New sub-docs:**
   ```bash
   ls -lt docs/plans/ docs/brainstorms/ 2>/dev/null
   ```
   Filter to entries newer than `last_updated`.

3. **GitHub activity (only if `parent_issue` is set, or the doc has explicit PR/issue links):**
   - If `parent_issue` is set, run `gh issue view <num> --comments` and `gh pr list --search "linked:<num>"`.
   - For any PR/issue links already in the doc, refresh state with `gh pr view <num> --json state,title,mergedAt` or `gh issue view <num> --json state,title,closedAt`.

4. **User-supplied context:** Anything the user said in the conversation or as additional argument framing (e.g., "we just merged the auth refactor"). Combine with repo evidence; don't replace it.

If nothing new is found, say so explicitly and ask the user what they want to log.

### Phase R3: Synthesize Proposed Update

Translate evidence into proposed changes:

- **Workstream checkboxes** to toggle. Be conservative: toggle only when evidence clearly indicates completion (PR merged, success criteria met). If ambiguous, leave unchecked and add a status note instead.
- **Cross-references to attach** — commit hashes, PR numbers, plan paths — to the relevant workstream's Links field.
- **Progress Log entry** (one or more) — dated today, one paragraph each, referencing the evidence concretely. Newest goes at the top of the section.
- **Regenerated Current State** paragraph (1–3 short paragraphs). Where we are right now, what just shipped, what's next.
- **Open Threads** — additions, or mark resolved with date + resolution.
- **Strategic Decision amendment** — only if the user explicitly changed direction. Logged as a dated amendment under the original decision, not a rewrite.

### Phase R4: Preview and Confirm

Use the platform's blocking question tool with a `preview` showing the proposed changes side-by-side with current state. Present as: changes per section, not the whole new file.

Options:
- **Confirm** — apply the surgical edits as shown
- **Edit** (free text via "Other") — accept revisions, then re-show the preview
- **Cancel** — abort without writing

If canceled, exit cleanly without modifying the file.

### Phase R5: Write Back Surgically

Use the **Edit** tool, not Write. Anchor edits on stable text:
- Frontmatter keys (`last_updated:`) for metadata bumps
- Section headers (`## Progress Log`, `## Current State`) for inserts
- Specific workstream lines (`- [ ] **W2: <name>**`) for checkbox toggles

Operations to perform:
- Toggle `[ ]` → `[x]` on completed workstreams.
- Insert new Progress Log entry at the top of the `## Progress Log` section (reverse-chronological).
- Replace the existing Current State paragraph(s).
- Append cross-references to workstream Links fields.
- Add or resolve Open Threads.
- Bump `last_updated:` to today's date.

Do not rewrite the full document. A failed Edit (anchor not found) means the doc has drifted — surface the failure, do not fall back to Write.

Confirm:
```
Initiative updated: docs/initiatives/<filename>
```

### Phase R6: Handoff

Offer the Resume-mode post-generation options (see Phase H below).

---

## Phase H: Post-generation Handoff

After a successful write (either mode), use the platform's blocking question tool with options that adapt to mode.

**Author Mode just finished:**
1. **Open in editor** — open the file using the platform's open mechanism (`open` on macOS, `xdg-open` on Linux, IDE API).
2. **Start `/plan` on Workstream 1** — invoke `/plan` with the first workstream's goal, surface area, and success criteria as input.
3. **Publish via `/create-initiative`** — hand off to `/create-initiative` to publish a parent GitHub issue + sub-issues. Once published, record the parent issue in this doc's frontmatter as `parent_issue: owner/repo#NNN` on the next resume.
4. **Done** — exit cleanly.

**Resume Mode just finished:**
1. **Open in editor**.
2. **Start `/plan` on next pending workstream** — pick the next unchecked workstream whose dependencies are satisfied.
3. **Mark initiative complete** — set frontmatter `status: completed`, regenerate Current State as a closing summary, and append a final Progress Log entry. Subsequent resumes are still allowed but the skill warns the initiative is closed.
4. **Done** — exit cleanly.

The "Other" option is automatically available for free-text revisions in either mode; loop back to options after handling.

---

## Initiative Document Template

This is the canonical structure. Author Mode writes it; Resume Mode preserves section ordering and edits surgically.

```markdown
---
title: <Initiative Title>
status: active                          # active | paused | completed | archived
date: YYYY-MM-DD                        # creation date
last_updated: YYYY-MM-DD                # bumped on every successful resume write-back
origin: docs/brainstorms/<path>.md      # optional, if seeded by a brainstorm
parent_issue: owner/repo#NNN            # optional, set after /create-initiative publishes
---

# <Initiative Title>

## Overview

<One paragraph: what this initiative is and why it exists. Stable across the life of the initiative.>

## Problem Frame

<Why this initiative is happening, what problem it solves, what would happen if we did nothing. Reference the origin brainstorm with `(see origin: <path>)` when carrying decisions forward.>

## Goals & Non-Goals

- **Goal:** ...
- **Goal:** ...
- **Non-goal:** ...

## Strategic Decisions

- **Decision:** <decision> — **Rationale:** <why> — **Date:** YYYY-MM-DD
  - *Amendment YYYY-MM-DD:* <what changed and why> *(only if a decision is later revised)*

## Current State

<1–3 short paragraphs, regenerated on each update. Where we are right now, what just shipped, what's next. This is what a fresh agent reads first to build context.>

## Workstreams

- [ ] **W1: <name>**
  - **Goal:** <one sentence>
  - **Surface area:** <directory / component / system>
  - **Dependencies:** none | W0 | external
  - **Success criteria:** <how this workstream is "done">
  - **Links:** <plans, brainstorms, PRs, issues — populated as work progresses>
  - **Status notes:** <short>
- [ ] **W2: <name>**
  - ...

## Progress Log

<Newest first. Each entry is dated and references concrete evidence.>

### YYYY-MM-DD

- <What happened, with refs to commits / PRs / plans / brainstorms.>

## Open Threads

- <Unresolved question, dependency, or decision still pending.>
  - *Resolved YYYY-MM-DD:* <resolution> *(append when resolved; do not delete the original)*

## Risks

- **Risk:** <risk> — **Mitigation:** <plan>

## Sources & References

- **Origin:** <brainstorm path, if any>
- **Parent issue:** <link, if published via /create-initiative>
- **Related plans:** <docs/plans/... entries>
- **Related PRs/issues:** #NNN
- **External:** <urls, if any>
```

## Rules

- Never write code or implementation details into the initiative doc — that's `/plan`'s job.
- Never delete from the Progress Log or Open Threads. Resolved threads are annotated, not removed.
- Never rewrite the whole file in Resume Mode. Use surgical Edit operations only.
- Always bump `last_updated:` on a successful Resume write-back.
- Always preview proposed changes before writing in Resume Mode.
- Always read the full existing doc first in Resume Mode — never assume context from prior conversation.
- Surface area in workstreams is described by directory/component/system, not exact file paths. Exact file paths belong in the per-workstream `/plan`.
- If the doc is malformed, surface the issue and ask. Never silently repair in a way that loses content.
- Workstream checkboxes toggle only when evidence clearly indicates completion. When ambiguous, add a status note instead.
- No external research. If a workstream needs external research, that happens inside its `/plan`.

NEVER CODE! Author or update the initiative doc. Hand off implementation to `/plan` and `/work`.
