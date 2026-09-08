---
name: blueprint-walk
description: >
  Walk through an implementation plan interactively, one unit at a time. Reads a plan
  produced by /blueprint, renders each unit's fields verbatim with a plain-English teach
  moment, then offers accept / modify / remove / add term / skip. Unfamiliar concepts go
  to a personal glossary without interrupting the walk, and `**Reviewed:**` state is
  written inline in the plan so progress is durable and resumable. Triggers on phrases
  like "walk the plan", "walk the blueprint", "review this plan with me",
  "blueprint-walk", or passing a path to a docs/plans/*.md file.
user-invocable: true
argument-hint: "[path to docs/plans/*.md]"
allowed-tools: Bash, Read, Edit, Write
---

# Blueprint Walk

Guide a human through a `/blueprint`-produced plan one **implementation unit** at a
time. Each unit is rendered verbatim, explained in plain English, and then acted on.
The plan document is the source of truth — `**Reviewed:**` state lives inline, so
walks resume cleanly across sessions.

This skill **consumes** plan docs. It never executes them (that is `/work`), never
writes code, never adds units, and never renumbers units.

It slots between `/blueprint` and `/work` and is entirely optional: a plan that is
never walked behaves exactly as it does today. Walking is most useful *after*
`/blueprint-deepen`, which splits and reorders units in place — a unit split after
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

## Step 4: Walk the Units

For each non-terminal unit, in plan order:

### 4a. Render the unit verbatim

Show the unit's heading (`Unit N: <name>`) and every field present in the doc,
**exactly as written**: `**Goal:**`, `**Requirements:**`, `**Dependencies:**`,
`**Files:**`, `**Approach:**`, `**Execution note:**`, `**Technical design:**`,
`**Patterns to follow:**`, `**Test scenarios:**`, `**Verification:**`.

Several of those are optional. **An absent field is the normal case** — Lightweight
plans routinely omit `Execution note`, `Technical design`, and `Test scenarios`. Show
what is there; never fabricate a missing field, and never fill one in from inference.
If the current `**Reviewed:**` state is present, show it too.

### 4b. Teach the unit

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

### 4c. Ask the action question

Ask via `AskUserQuestion`:

- **Accept** — the unit is right as written; mark it reviewed and advance.
- **Modify** — something is wrong; describe it, and the skill drafts a replacement.
- **Remove** — this unit should not be built; retire it in place.
- **Add term** — capture an unfamiliar concept to the glossary. **Does not advance
  the unit** — the menu is re-asked afterward, and review state is untouched.
- **Skip** — no verdict now; move on. Reported at the end as *unreviewed*, never as
  accepted.

Ask this question for **every** unit, one at a time. Never collapse several units into
one question, and never offer a batch verdict — not even when the remaining units look
alike.

`Add term` (and any request for a deeper explanation) is a **self-loop**: handle it,
then re-ask this same question on the same unit. Both are repeatable any number of
times on one unit. That is the entire point of the side-buffer — learning must not
cost the review thread.

Then execute the chosen action using the Review-State Write Protocol (Step 5).

## Step 5: Review-State Write Protocol

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

### 5a. Anchoring rule (mandatory)

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#anchoring) — it owns the
match-count check, the required `--`, the read-the-printed-count rule, and the
stop-on-ambiguity rule. Every `Edit` in this step runs it, without exception.

This walk's unique identifier is the `Unit N:` ordinal. Two units can share a name, so the ordinal is the only token `/blueprint` guarantees unique. Count on the ordinal-bearing line, matching the checkbox as it actually is — `/work` may already have built the unit, so it can read `- [x]`.

### 5b. Re-read before every write

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#re-read-before-every-write).
Build every anchor from the fresh read of the unit's current on-disk text, never from
the text captured when it was rendered.

### 5c. Claim the unit first

The **first** write on any unit sets `**Reviewed:** pending` — before any other
mutation, and before the destructive actions do anything. A unit left
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

**5a and 5b bind every action below, without exception.** Each of the five actions
writes through the same protocol: build the anchor from a fresh read (5b), run 5a's
match-count check, then `Edit`. The two destructive actions repeat that instruction at
their own write sites because they write twice; the others say it once, here. There is
no backup — the match-count check is the only thing standing between a mis-built anchor
and a corrupted plan, so it is never optional.

### 5d. Accept

1. Set `**Reviewed:** accepted`.
2. No note required. If the user volunteers one, add `**Review note:** <text>` on the
   line below.
3. Advance to the next unit.

### 5e. Modify

Modify is **destructive** — it replaces doc text that is not in git. Follow
[the walk-protocol spec](../walk-protocol/SKILL.md#destructive-actions) exactly: ask
what is wrong, claim the unit (5c), draft the replacement, edit only the changed
span while carrying untouched text through byte-identical, show a labelled
before/after, and confirm **Apply** / **Revise** / **Cancel** before any write.

On Apply, set `**Reviewed:** modified` with a required `**Review note:**` recording what
changed and why. Never renumber the unit and never change its `Unit N:` ordinal and heading position.

### 5f. Remove

Remove is **equally destructive** as modify and gets the same confirmation. Do not
treat it as the lighter action.

1. Ask the user why the unit should not be built.
2. Claim the unit `pending` (5c).
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
   unchanged and 5a still matches on `- [x] **Unit 4:`. Do not strike through, comment
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
6. On **Retire**: run the 5a match-count check, re-read (5b), apply the `Edit`, set
   `**Reviewed:** retired` and a required `**Review note:**` recording the reason —
   **and, when other units cite it, the citations, durably in that note**:

   ```
   **Reviewed:** `retired`
   **Review note:** retired — superseded by Unit 2; cited by Units 3, 5, 6; those were not updated
   ```

   A terminal warning disappears at the end of the session; the note is what a later
   reader of the plan actually sees.

### 5g. Add term

1. Capture the term to the glossary (Step 6).
2. **Do not touch `**Reviewed:**`.** No state change of any kind.
3. Re-ask the Step 4c action question on the same unit. Repeatable.

### 5h. Skip

1. Set `**Reviewed:** skipped`. No note required; record one if the user offers.
2. Change nothing else in the unit.
3. Advance. Skipped units are reported at walk end as **unreviewed** — never folded
   into accepted.

## Step 6: Capture a Term to the Glossary

Where `Add term` (5g) routes. Follow
[the walk-protocol spec](../walk-protocol/SKILL.md#capturing-a-term) exactly — it owns
the side-buffer contract, the one-answer flow, and the delegation to `/term-add` in
quiet mode. Re-ask the Step 4c action question on the same unit afterward.

## Step 7: Finish the Walk

Reached when every unit is terminal — either walked through in this session or
already terminal when Step 3 checked — or when the user ends the walk early. An early
end still runs 7a: the counts are derived from the doc, so a partial walk reports
truthfully rather than not at all, with the unwalked units falling into the
never-reached and left-pending buckets.

### 7a. Report the Summary

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#the-summary) — it owns the
re-read-from-disk rule, the bucket set, and the requirement that the buckets sum to the
doc's total unit count.

Read the state lines with:

```bash
grep -n -E '^\*\*Reviewed:\*\*' docs/plans/<file>.md
```

Retired units whose `**Review note:**` records citations from other units' `**Dependencies:**` are the dangling references tombstoning leaves behind; count them from the notes rather than re-scanning the plan.

This walk's terminal verdicts are **accepted / modified / retired**; `skipped` reports as *unreviewed*.

Example shape:

> "Walk complete — 12 units: 7 accepted, 2 modified, 1 retired, 1 skipped
> (unreviewed), 1 never reached. 1 retired unit is still cited by other units'
> `Dependencies:` — see its review note. 3 terms captured to `~/.claude/glossary.md`."

### 7b. Stamp the Walk Outcome

The stamp fires only here, at final summary — a walk that dies without reaching Step 7
(a crash, a closed session) posts nothing, and a resumed walk stamps only when it reaches
this step. A walk the user deliberately ends early *does* reach Step 7, so it stamps, with
the unwalked units counted in the unreviewed line. Counts come from 7a, so they
describe the whole plan rather than this session's slice. Issue-number resolution
(including the silent skip when none resolves), posting mechanics, marker encoding, and
failure handling are defined in [the issue-log spec](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"blueprint-walk","event":"blueprint-walk-complete","paths":["docs/plans/<file>.md"]} -->

### 🚶 /blueprint-walk — walk complete

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
  the whole Step 4 protocol keys off a unique `Unit N:` ordinal, and without units there
  is no safe place to put state and no way to resume from it. Skip Steps 4 and 7b
  entirely: no writes, no stamp. Say this to the user up front rather than
  degrading quietly:
  > "No units to anchor review state to — this is a read-only walk. Nothing will be
  > written to the plan, and no progress is saved if we stop."
- Walk the plan's `##` sections in document order instead of units, rendering each
  verbatim and teaching it per Step 4b.
- The action question narrows to **Add term** / **Next** / **Stop**. Accept, Modify and
  Remove are all off the table — the first two have nowhere to record a verdict, and the
  third has no block to tombstone.
- **Add term (Step 6) works unchanged.** It never touched the plan doc anyway, so it is
  the one part of the walk that is fully intact here. In practice it is most of what
  fallback mode is good for.
- Report a summary at the end (7a) covering only sections seen and terms captured. No
  verdict counts exist to report.

The useful framing for the user: fallback mode is a guided read-through with a glossary
attached, not a review. If they want verdicts recorded, the plan needs re-running
through `/blueprint`.

## Rules

- **Never write code and never execute the plan.** That is `/work`. This skill only
  reads plans, edits their review state, and delegates term capture to `/term-add`.
- **Walk order is fixed and every unit is presented individually.** Plan order is
  the walk's order: start at the resume point and advance one unit at a time, never
  reordering and never letting the user pick where to start. **Never offer to batch** —
  no "accept all of these?", no verdict spanning several units, no bundling behind one
  question. Each unit gets its own render, its own teach moment, and its own action
  question, even when every unit has the same obvious answer and the batch would be
  faster. The walk exists so each unit is actually looked at; a shortcut that skips
  presentation defeats the point of running it.
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
  means refusing to write and surfacing it (5a). Never guess which match is right.
- **The plan doc is the source of truth.** If the user edits it between turns, re-read
  before the next action so the change is picked up — and rebuild every anchor from that
  read.
- **Skipped is not accepted.** A skip records `skipped` and is reported as unreviewed at
  walk end.
