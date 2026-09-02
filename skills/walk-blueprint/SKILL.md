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
  ambiguity if the file was edited mid-walk). It also orders same-day plans by their
  `NNN` sequence, which `mtime` gets wrong whenever an earlier plan was edited later.

  The glob is repo-root-relative. Run it from the repo root; from a worktree, note that
  `docs/` is a symlink to the primary checkout's, so the same command resolves there.

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

**Both checkbox states count.** A plan whose units are all `- [x]` is a fully built plan,
not an old-shape one — it is still Standard, and still walkable. Fallback requires *no*
`**Unit N:` checkbox items of either state.

Announce the mode briefly:

> "Plan has N units in the standard shape — walking them in order."
> or
> "This plan predates the current unit shape (no `- [ ]` / `- [x] **Unit` items) —
> falling back."

Note the units' order as they appear in the doc. **Plan order is walk order.** Never
reorder, and never renumber.

## Step 3: Detect the Resume Point

Parse every unit's `**Reviewed:**` line (units without one are unreviewed). Decide
where to start:

1. If any unit is `**Reviewed:** pending`, **resume there** — a previous walk was
   interrupted after claiming the unit but before recording a verdict. Announce:
   > "Resuming at Unit 4 (last left pending)."
   If more than one unit is `pending`, resume at the **first** in plan order and say so.

   A `pending` unit takes the entry point even when earlier units are non-terminal —
   finishing the interrupted verdict comes first. **Those earlier units are not
   abandoned:** after the `pending` unit gets its verdict, fall back to rule 2 and
   continue from the first non-terminal unit in plan order, which walks back to them.
   The walk is over when rule 3 holds, never when the last unit is reached.
2. Else, the entry point is the first non-terminal unit in plan order. Terminal
   values are `accepted`, `modified`, `retired`, `skipped`. A missing
   `**Reviewed:**` line is non-terminal, and so is `pending`.
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

The written block sits directly under the unit's checkbox line, separated from it by a
blank line, and followed by a blank line before the unit's first field:

```
- [ ] **Unit 3: Wire the glossary writer**

**Reviewed:** `accepted`
**Review note:** <why — required for modified, retired; optional for skipped>

**Goal:** …
```

`**Reviewed:**` and `**Review note:**` are adjacent with **no** blank line between them —
they are one block. The blank lines around that block are what keep it from being
absorbed into the heading or the first field when the plan renders.

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
grep -c -F -- "<exact anchor text>" docs/plans/<file>.md
```

The `--` is **required**, not stylistic: every unit anchor starts with `- `, and without
it `grep` reads the anchor as an option bundle and exits 2 with `invalid option` instead
of printing a count. An error here reads as "no output", which is the one outcome this
check must never produce silently.

(For a multi-line anchor, count on the ordinal-bearing line — `- [ ] **Unit 3:` — and
confirm the following lines from the fresh read. Match the checkbox as it actually is:
`/work` may already have built the unit, so the line can read `- [x]`.)

Read the **printed count**, not the presence of output — and treat a non-zero exit
alongside no count as a broken invocation, never as a result. `grep` exits 1 on a clean
zero match (printing `0`) and 2 on a usage error (printing nothing); only the first is
an answer.

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

**Goal:** …
```
→
```
- [ ] **Unit 3: Wire the glossary writer**

**Reviewed:** `pending`

**Goal:** …
```

Anchor the `Edit` on the checkbox line *plus* the following blank line and the first
field label — the checkbox line alone leaves the insertion point ambiguous about which
blank line is which.

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
4. **Edit only the region that changes; never regenerate the whole unit.** Scope the
   `Edit` to the smallest span containing the change — one bullet, one field — and leave
   every other field out of the `old_string` entirely. Text never passed to an `Edit`
   cannot be corrupted by one.

   **Carry every untouched field through verbatim.** If the requested change is about
   `**Approach:**`, then `**Test scenarios:**`, `**Verification:**`, `**Files:**` and
   the rest must come out byte-identical. A regenerated block that quietly drops or
   rewords a field the user never mentioned is a silent data loss, not an improvement.
   Rewriting the unit wholesale is the single most likely way to cause that, which is
   why the edit is scoped instead.
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
   ordinal, its heading, and **its entire body verbatim** — every field stays exactly
   as written.

   The tombstone is the state block and nothing else: `**Reviewed:** retired` plus its
   note, inserted in the usual place, with a `~~RETIRED~~` marker appended to the
   heading text so a reader scanning the plan sees it without reading state lines:

   ```
   - [x] **Unit 4: Review phase — deep-review machinery, unattended** ~~RETIRED~~

   **Reviewed:** `retired`
   **Review note:** retired — superseded by Unit 2; cited by Units 3, 5, 6; those were not updated

   **Goal:** …
   ```

   The marker goes **after** the closing `**` so the ordinal-bearing anchor text is
   unchanged and 6a still matches on `- [x] **Unit 4:`. Do not strike through, comment
   out, or blank the fields — a retired unit still has to be readable to explain why it
   was retired, and `/work` must still be able to find its heading.
4. **Scan for citations.** Search the plan for other units naming this ordinal in
   their `**Dependencies:**` (including ranges that span it):

   ```bash
   grep -n "Dependencies:" docs/plans/<file>.md
   ```

   Read the hits and work out which ones cover this ordinal. **Never auto-edit another
   unit** — dependency handling is warn-only.

   **Grep for the label only, never for the ordinal.** Narrowing the pattern to the
   number (`grep "Dependencies:.*4"`) looks tighter and is wrong: it finds the literal
   `Unit 4` and silently misses `Units 3–6` and `Units 2–7`, which both span it —
   exactly the citations that matter most, since a range hides the ordinal it covers.
   The unfiltered list is short (one line per unit); reading it is the check. Note also
   that ranges are written with an **en-dash** (`–`, U+2013), not a hyphen, so an
   ASCII-hyphen pattern matches nothing at all.
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

1. Capture the term to the glossary (Step 7).
2. **Do not touch `**Reviewed:**`.** No state change of any kind.
3. Re-ask the Step 5c action question on the same unit. Repeatable.

### 6h. Skip

1. Set `**Reviewed:** skipped`. No note required; record one if the user offers.
2. Change nothing else in the unit.
3. Advance. Skipped units are reported at walk end as **unreviewed** — never folded
   into accepted.

## Step 7: Capture a Term to the Glossary

This is where `Add term` (6g) routes. It is a **side buffer**: it writes to one file
outside the repo and touches nothing else. Capturing a term does **not** take the plan
backup (Step 4), does **not** write `**Reviewed:**`, and does **not** advance the unit
— the plan doc is not opened at all. A walk that only captures terms leaves the plan
byte-identical and produces no `.bak`.

Speed is the requirement. This runs mid-review and its entire purpose is to not derail
the walk, so it costs the user **one answer**:

1. Ask for the term, and nothing else:
   > "What term should I capture?"

2. Follow [term-add](../term-add/SKILL.md) exactly, in
   [quiet mode](../glossary/SKILL.md#quiet-mode), passing that answer as the term. It
   drafts the definition and every other field, writes the entry, and emits its one
   confirmation line — which is the only output the walk shows. This skill adds no
   glossary behavior of its own and defines no part of the entry format.

3. Immediately re-ask the Step 5c action question on the same unit.

Repeatable any number of times on one unit (6g). Each capture is independent; nothing is
batched until walk end.

## Step 8: Finish the Walk

Reached when every unit is terminal — either walked through in this session or
already terminal when Step 3 checked — or when the user ends the walk early. An early
end still runs 8a: the counts are derived from the doc, so a partial walk reports
truthfully rather than not at all, with the unwalked units falling into the
never-reached and left-pending buckets.

### 8a. Report the Summary

**Re-read the plan from disk and derive every count from its `**Reviewed:**` lines.**
Never count from session memory. A walk resumed across sessions has verdicts on units
this session never rendered, and a user may have hand-edited state between turns; only
the doc knows the whole plan's totals.

Read the current text and bucket every unit by its `**Reviewed:**` value:

```bash
grep -n -E '^\*\*Reviewed:\*\*' docs/plans/<file>.md
```

Report:

- **Accepted / modified / retired** — the three reviewed verdicts, with counts.
- **Skipped** — reported as **unreviewed**. Never folded into accepted; the user
  declined to give a verdict, which is not the same as approving the unit.
- **Never reached** — units carrying **no `**Reviewed:**` line at all**. Distinct from
  skipped: nobody looked at these. Keep the two buckets separate and name them
  separately, so "12 units, 9 accepted" never hides three units the walk never showed.
- **Left pending** — units still reading `**Reviewed:** pending`. A normal walk reaches
  8a with none, but a hand-edit or an abandoned earlier walk can leave one, and the
  grep will surface it. Report it in its own bucket; never fold it into any other and
  never drop it. **The bucket counts must sum to the plan's total unit count** — if
  they do not, a value is unaccounted for and the summary is wrong.
- **Retired units still cited** — count the retired units whose `**Review note:**`
  records citations from other units' `**Dependencies:**` (6f writes them there). Read
  the notes; do not re-scan the plan. These are the dangling references tombstoning
  leaves behind, and nothing has fixed them.
- **Terms added** — how many terms this session captured to `~/.claude/glossary.md`.
  This one count *is* session-scoped: the glossary is shared across every plan the
  user walks, so a re-read cannot tell this walk's captures from an earlier walk's.
- **Backup** — if a `.bak` was taken (Step 4), name its path in one line so the user
  knows it exists and can delete it once satisfied.

Example shape:

> "Walk complete — 12 units: 7 accepted, 2 modified, 1 retired, 1 skipped
> (unreviewed), 1 never reached. 1 retired unit is still cited by other units'
> `Dependencies:` — see its review note. 3 terms captured to
> `~/.claude/glossary.md`. Backup at `docs/plans/<file>.md.bak`."

Omit a bucket that is zero rather than printing `0 pending`, but never omit a non-zero
one to keep the sentence short.

### 8b. Stamp the Walk Outcome

The stamp fires only here, at final summary — a walk that dies without reaching Step 8
(a crash, a closed session) posts nothing, and a resumed walk stamps only when it reaches
this step. A walk the user deliberately ends early *does* reach Step 8, so it stamps, with
the unwalked units counted in the unreviewed line. Counts come from 8a, so they
describe the whole plan rather than this session's slice. Issue-number resolution
(including the silent skip when none resolves), posting mechanics, marker encoding, and
failure handling are defined in [the issue-log spec](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"walk-blueprint","event":"blueprint-walk-complete","paths":["docs/plans/<file>.md"]} -->

### 🚶 /walk-blueprint — walk complete

**Summary:** <n> units walked — <n> accepted, <n> modified, <n> retired, <n> skipped
**Unreviewed:** <n> skipped, <n> never reached, <n> left pending
**Retired still cited:** <n> — <Unit N, Unit N> named in other units' Dependencies
**Terms added:** <n> — <term, term, term>
```

```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

Omit `**Retired still cited:**` when nothing was retired or nothing cites what was, and
omit `**Terms added:**` when no term was captured. There is no `**Doc:**` field — the
walk produces no document of its own, and the walked plan's path rides in `paths`.

## Fallback Mode Details

Fallback is entered from Step 2 when the plan has no `**Unit N:` checkbox items at all —
neither `- [ ]` nor `- [x]`.
Deltas against the main path:

- **No review state is written.** There is nothing to anchor a `**Reviewed:**` line to —
  the whole Step 6 protocol keys off a unique `Unit N:` ordinal, and without units there
  is no safe place to put state and no way to resume from it. Skip Steps 4, 6, and 8b
  entirely: no backup, no writes, no stamp. Say this to the user up front rather than
  degrading quietly:
  > "No units to anchor review state to — this is a read-only walk. Nothing will be
  > written to the plan, and no progress is saved if we stop."
- Walk the plan's `##` sections in document order instead of units, rendering each
  verbatim and teaching it per Step 5b.
- The action question narrows to **Add term** / **Next** / **Stop**. Accept, Modify and
  Remove are all off the table — the first two have nowhere to record a verdict, and the
  third has no block to tombstone.
- **Add term (Step 7) works unchanged.** It never touched the plan doc anyway, so it is
  the one part of the walk that is fully intact here. In practice it is most of what
  fallback mode is good for.
- Report a summary at the end (8a) covering only sections seen and terms captured. No
  verdict counts exist to report.

The useful framing for the user: fallback mode is a guided read-through with a glossary
attached, not a review. If they want verdicts recorded, the plan needs re-running
through `/blueprint`.

## Rules

- **Never write code and never execute the plan.** That is `/work`. This skill only
  reads plans, edits their review state, and delegates term capture to `/term-add`.
- **Never renumber, reorder, or delete units**, and never add one. Ordinals are
  load-bearing: other units cite them, and `/work` composes issue-stamp keys from unit
  headings.
- **Never fabricate a missing field.** An absent `**Execution note:**` or
  `**Test scenarios:**` is normal. Render what exists; never infer the rest.
- **Never modify or retire without the before/after confirm.** Both actions destroy plan
  text that is not in git. The user sees old and new, labeled, and says apply.
- **Never edit another unit's `**Dependencies:**`** when retiring. Dependency fallout is
  warn-only and recorded in the retired unit's `**Review note:**`.
- **Stop the walk on an ambiguous anchor.** More than one match for an `Edit` anchor
  means refusing to write and surfacing it (6a). Never guess which match is right.
- **The plan doc is the source of truth.** If the user edits it between turns, re-read
  before the next action so the change is picked up — and rebuild every anchor from that
  read.
- **Skipped is not accepted.** A skip records `skipped` and is reported as unreviewed at
  walk end.
