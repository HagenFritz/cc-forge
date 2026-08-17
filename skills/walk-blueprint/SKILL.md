---
name: walk-blueprint
description: >
  Walk through an implementation plan interactively, one unit at a time. Reads a plan
  produced by /blueprint, renders each unit's fields verbatim with a plain-English teach
  moment, then offers accept / modify / remove / add term / skip. Unfamiliar concepts go
  to a personal glossary without interrupting the walk, and `**Reviewed:**` state is
  written inline in the plan so progress is durable and resumable. Triggers on phrases
  like "walk the plan", "walk the blueprint", "review this plan with me",
  "walk-blueprint", or passing a path to a docs/plans/*.md file.
user-invocable: true
argument-hint: "[path to docs/plans/*.md]"
allowed-tools: Bash, Read, Edit, Write
---

# Walk Blueprint

Guide a human through a `/blueprint`-produced plan one **implementation unit** at a
time. Each unit is rendered verbatim, explained in plain English, and then acted on.
The plan document is the source of truth — `**Reviewed:**` state lives inline, so
walks resume cleanly across sessions.

This skill **consumes** plan docs. It never executes them (that is `/work`), never
writes code, never adds units, and never renumbers units.

It slots between `/blueprint` and `/work` and is entirely optional: a plan that is
never walked behaves exactly as it does today. Walking is most useful *after*
`/deepen-blueprint`, which splits and reorders units in place — a unit split after
being walked hands its verdict to both halves, and nothing detects that.

## Step 1: Resolve the Plan Path

- If the user passed a path, use it. Verify the file exists with `ls`.
- If no path was passed, auto-discover the newest plan:

  ```bash
  ls docs/plans/*.md 2>/dev/null | sort | tail -1
  ```

  The filename convention is `YYYY-MM-DD-NNN-<type>-<slug>-plan.md`, so a
  lexicographic sort picks the most recent doc deterministically (no `mtime`
  ambiguity if the file was edited mid-walk).

- If no plan docs exist, STOP and tell the user to run `/blueprint` first.
- Confirm the resolved path back to the user before continuing:
  > "Walking plan: `docs/plans/<file>.md`. Proceed?"
  Use `AskUserQuestion` with Yes / Cancel.

## Step 2: Read the Plan and Detect Shape

Read the full plan doc. Determine whether its `## Implementation Units` section
contains units in the current shape — top-level checkbox list items matching
`- [ ] **Unit N:` (or `- [x] **Unit N:`, already built by `/work`).

Detection is **structural**, never by the doc's `date:` or by any version marker.

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Standard** | One or more units match `- [ ] **Unit N:` / `- [x] **Unit N:` | Full walk: render, teach, act, write review state per unit. |
| **Fallback** | No such matches | Degraded read-only-ish walk; see `## Fallback Mode Details`. |

Announce the mode briefly:

> "Plan has N units in the standard shape — walking them in order."
> or
> "This plan predates the current unit shape (no `- [ ] **Unit` items) — falling back."

Note the units' order as they appear in the doc. **Plan order is walk order.** Never
reorder, and never renumber.

## Step 3: Detect the Resume Point

Parse every unit's `**Reviewed:**` line (units without one are unreviewed). Decide
where to start:

1. If any unit is `**Reviewed:** pending`, **resume there** — a previous walk was
   interrupted after claiming the unit but before recording a verdict. Announce:
   > "Resuming at Unit 4 (last left pending)."
   If more than one unit is `pending`, resume at the **first** in plan order and say so.
2. Else, the entry point is the first non-terminal unit in plan order. Terminal
   values are `accepted`, `modified`, `retired`, `skipped`. A missing
   `**Reviewed:**` line is non-terminal.
3. If every unit is terminal, report completion and exit — jump straight to the final
   summary:
   > "Walk already complete. All N units are accepted / modified / retired / skipped."

The `**Reviewed:**` field is the *only* review-state store. Never use the
`- [ ]` / `- [x]` checkbox for it — `/work` and `/grind` own the checkbox to mean
*built*, and the two must not collide.

## Step 4: Take the Backup

**Before the first mutating write of the walk** (not at walk start — a walk that only
reads should leave nothing behind), copy the plan beside itself:

```bash
cp docs/plans/<file>.md docs/plans/<file>.md.bak
```

`docs/plans/` is gitignored, so there is no `git checkout` to fall back on. This copy
is the **only** recovery path for a botched `modify` or `remove`. Take it exactly once
per walk; if a `.bak` from a previous walk already exists, overwrite it and mention
that in one line. Tell the user where the backup is, once.

## Step 5: Walk the Units

For each non-terminal unit, in plan order:

### 5a. Render the unit verbatim

Show the unit's heading (`Unit N: <name>`) and every field present in the doc,
**exactly as written**: `**Goal:**`, `**Requirements:**`, `**Dependencies:**`,
`**Files:**`, `**Approach:**`, `**Execution note:**`, `**Technical design:**`,
`**Patterns to follow:**`, `**Test scenarios:**`, `**Verification:**`.

Several of those are optional. **An absent field is the normal case** — Lightweight
plans routinely omit `Execution note`, `Technical design`, and `Test scenarios`. Show
what is there; never fabricate a missing field, and never fill one in from inference.
If the current `**Reviewed:**` state is present, show it too.

### 5b. Teach the unit

Compose a plain-English explanation of what this unit is actually asking for:

- Lead with the point in non-jargon terms (e.g. "This unit is about making the walk
  survive being interrupted — it writes a marker into the plan before it changes
  anything, so a crash is distinguishable from a clean start.").
- Say why it exists — what breaks or stays broken without it.
- Name any dependency it has on earlier units and what that ordering buys.
- Keep it to **3–6 sentences**. The goal is comprehension, not a lecture.

Explain from the **plan text alone**. Do not read the files the unit cites: a plan
describes code that does not exist yet, so re-reading buys little and costs walk
momentum. If a unit is genuinely unexplainable from its own text, say so plainly
rather than inventing context.

### 5c. Ask the action question

Ask via `AskUserQuestion`:

- **Accept** — the unit is right as written; mark it reviewed and advance.
- **Modify** — something is wrong; describe it, and the skill drafts a replacement.
- **Remove** — this unit should not be built; retire it in place.
- **Add term** — capture an unfamiliar concept to the glossary. **Does not advance
  the unit** — the menu is re-asked afterward, and review state is untouched.
- **Skip** — no verdict now; move on. Reported at the end as *unreviewed*, never as
  accepted.

`Add term` (and any request for a deeper explanation) is a **self-loop**: handle it,
then re-ask this same question on the same unit. Both are repeatable any number of
times on one unit. That is the entire point of the side-buffer — learning must not
cost the review thread.

Then execute the chosen action using the Review-State Write Protocol (Step 6).

## Step 6: Review-State Write Protocol

The plan doc is the durable progress store. Every advancing action writes a
`**Reviewed:**` line into the unit using `Edit`.

The written block sits directly under the unit's checkbox line:

```
- [ ] **Unit 3: Wire the glossary writer**

**Reviewed:** `accepted`
**Review note:** <why — required for modified, retired; optional for skipped>
```

`**Reviewed:**` takes exactly one of: `pending`, `accepted`, `modified`, `retired`,
`skipped`.

### 6a. Anchoring rule (mandatory)

Every `Edit` anchor **must contain the `Unit N:` ordinal**. The ordinal is the only
token `/blueprint` guarantees unique. Two units can share a name, and once both carry
`**Reviewed:** pending` the checkbox-line + state-line pair becomes *identical text in
two places* — an anchor that would report success while silently mutating the wrong
unit. Uniqueness must hold by construction, not by luck.

Before **every** `Edit`, count matches for the exact `old_string` you are about to
use:

```bash
grep -c -F "<exact anchor text>" docs/plans/<file>.md
```

(For a multi-line anchor, count on the ordinal-bearing line — `- [ ] **Unit 3:` — and
confirm the following lines from the fresh read.)

- **Exactly 1 match** → proceed with the `Edit`.
- **0 matches** → the doc changed under you. Re-read and rebuild the anchor; if it
  still does not match, STOP and show the user what you expected versus what is there.
- **More than 1 match** → **STOP the walk.** Do not edit. Surface the ambiguity:
  > "Unit 3's anchor matches 2 places in the plan — refusing to write. Please
  > disambiguate the plan (the units appear duplicated) and re-run."
  Never guess which match is the right one.

### 6b. Re-read before every write

Immediately before each `Edit`, `Read` the unit's current on-disk text and build the
anchor from *that*, not from the text captured when the unit was rendered in Step 5a.
A user may edit the plan in another editor mid-walk; rebuilding closes the window
where a stale anchor either fails or matches something unintended.

### 6c. Claim the unit first

The **first** write on any unit sets `**Reviewed:** pending` — before any other
mutation, and before the backup-dependent destructive actions do anything. A unit left
`pending` is unambiguously "a walk started here and did not finish", which is exactly
what Step 3 resumes on.

Insert it directly below the checkbox line:

```
- [ ] **Unit 3: Wire the glossary writer**
```
→
```
- [ ] **Unit 3: Wire the glossary writer**

**Reviewed:** `pending`
```

If the unit already carries a `**Reviewed:**` line (a re-walk), edit its value in
place rather than inserting a second one.

### 6d. Accept

1. Set `**Reviewed:** accepted`.
2. No note required. If the user volunteers one, add `**Review note:** <text>` on the
   line below.
3. Advance to the next unit.

### 6e. Modify

Modify is **destructive** — it replaces plan text that cannot be recovered from git.

1. Ask the user what is wrong with the unit, in their words.
2. Take the backup (Step 4) if not yet taken, then claim the unit `pending` (6c).
3. **Draft** the replacement text. The skill drafts; the user approves. The user is
   reviewing, not authoring.
4. **Carry every untouched field through verbatim.** If the requested change is about
   `**Approach:**`, then `**Test scenarios:**`, `**Verification:**`, `**Files:**` and
   the rest must come out byte-identical. A regenerated block that quietly drops or
   rewords a field the user never mentioned is a silent data loss, not an improvement.
5. Show a **before/after** of the changed region — the old text and the drafted
   replacement, clearly labeled.
6. Ask via `AskUserQuestion`: **Apply** / **Revise** (re-draft from further feedback,
   then re-show) / **Cancel**.
   - On **Cancel**, leave the unit's text untouched and reset `**Reviewed:**` to its
     prior value (or remove the `pending` line if there was none).
7. Only on **Apply**: run the 6a match-count check, re-read (6b), apply the `Edit`,
   then set `**Reviewed:** modified` with a required `**Review note:** <one line on
   what changed and why>`.

Never renumber the unit and never change its `Unit N:` ordinal or heading position.

### 6f. Remove

Remove is **equally destructive** as modify and gets the same confirmation. Do not
treat it as the lighter action.

1. Ask the user why the unit should not be built.
2. Take the backup (Step 4) if not yet taken, then claim the unit `pending` (6c).
3. **Tombstone in place — never delete the block, never renumber.** Units
   cross-reference each other by ordinal, including ranges (`Dependencies: Units 3–6`),
   and `/work` composes issue-stamp keys from the unit's heading text. Removing the
   block or shifting ordinals invalidates both. The unit keeps its position, its
   ordinal, and its heading; its body is marked retired.
4. **Scan for citations.** Search the plan for other units naming this ordinal in
   their `**Dependencies:**` (including ranges that span it):

   ```bash
   grep -n "Dependencies:" docs/plans/<file>.md
   ```

   Read the hits and work out which ones cover this ordinal. **Never auto-edit another
   unit** — dependency handling is warn-only.
5. Show a **before/after** of the tombstoned block and ask via `AskUserQuestion`:
   **Retire** / **Cancel**. On Cancel, restore the prior `**Reviewed:**` state and
   change nothing.
6. On **Retire**: run the 6a match-count check, re-read (6b), apply the `Edit`, set
   `**Reviewed:** retired` and a required `**Review note:**` recording the reason —
   **and, when other units cite it, the citations, durably in that note**:

   ```
   **Reviewed:** `retired`
   **Review note:** retired — superseded by Unit 2; cited by Units 3, 5, 6; those were not updated
   ```

   A terminal warning disappears at the end of the session; the note is what a later
   reader of the plan actually sees.

### 6g. Add term

1. Capture the term to the glossary (see the glossary section).
2. **Do not touch `**Reviewed:**`.** No state change of any kind.
3. Re-ask the Step 5c action question on the same unit. Repeatable.

### 6h. Skip

1. Set `**Reviewed:** skipped`. No note required; record one if the user offers.
2. Change nothing else in the unit.
3. Advance. Skipped units are reported at walk end as **unreviewed** — never folded
   into accepted.

## Step 7: Capture a Term to the Glossary

<!-- Filled in by the glossary unit: file location, entry format, creation-on-first-use,
     append-without-duplicate behavior, and the capture prompt. -->
