---
name: brainstorm-walk
description: >
  Walk through a requirements document interactively, one requirement at a time. Reads a
  requirements doc produced by /brainstorm, renders each `R`-bullet verbatim with a
  plain-English teach moment, then offers accept / modify / remove / add term / skip.
  Unfamiliar concepts go to a personal glossary without interrupting the walk, and
  `**Reviewed:**` state is written inline in the doc so progress is durable and
  resumable. Triggers on phrases like "walk the requirements", "walk the brainstorm",
  "review these requirements with me", "brainstorm-walk", or passing a path to a
  docs/brainstorms/*-requirements.md file.
user-invocable: true
argument-hint: "[path to docs/brainstorms/*-requirements.md]"
allowed-tools: Bash, Read, Edit, Write
---

# Brainstorm Walk

Guide a human through a `/brainstorm`-produced requirements doc one **requirement** at
a time. Each `R`-bullet is rendered verbatim, explained in plain English, and then
acted on. The requirements document is the source of truth — `**Reviewed:**` state
lives inline, so walks resume cleanly across sessions.

This skill **consumes** requirements docs. It never plans them (that is `/blueprint`),
never writes code, never adds requirements, and never renumbers them.

It slots between `/brainstorm` and `/blueprint` and is entirely optional: a
requirements doc that is never walked behaves exactly as it does today.

`/brainstorm-walk` is to a requirements doc what `/blueprint-walk` is to a plan and
`/review-walk` is to a review doc. The three share a shape deliberately; where this one
diverges, the divergence is called out in place.

## Step 1: Resolve the Requirements Path

- If the user passed a path, use it. Verify the file exists with `ls`.
- If no path was passed, auto-discover the newest requirements doc:

  ```bash
  ls docs/brainstorms/*-requirements.md 2>/dev/null | sort | tail -1
  ```

  The filename convention is `YYYY-MM-DD-NNN-<slug>-requirements.md`, so a
  lexicographic sort picks the most recent doc deterministically (no `mtime`
  ambiguity if the file was edited mid-walk). It also orders same-day docs by their
  `NNN` sequence, which `mtime` gets wrong whenever an earlier doc was edited later.

  The glob is repo-root-relative. Run it from the repo root; from a worktree, note that
  `docs/` is a symlink to the primary checkout's, so the same command resolves there.

  Not every requirements doc carries an `NNN` sequence — the oldest ones are
  `YYYY-MM-DD-<slug>-requirements.md`. The sort still orders them correctly by date;
  only same-day ordering depends on the sequence.

- If no requirements docs exist, STOP and tell the user to run `/brainstorm` first.
- Confirm the resolved path back to the user before continuing:
  > "Walking requirements: `docs/brainstorms/<file>.md`. Proceed?"
  Use `AskUserQuestion` with Yes / Cancel.

## Step 2: Read the Doc and Check the Precondition

Read the full requirements doc. Find its `## Requirements` section and count the
top-level bullets carrying an `R`-ID — an `R` followed by digits and a period at the
start of a list item, either bare or wrapped in bold:

```bash
grep -c -E '^- (\*\*)?R[0-9]+\.' docs/brainstorms/<file>.md
```

**Both forms are live in the corpus and both are walkable.** Current docs write
`- R1. **Title.** …`; one older doc writes `- **R1.** …` with the ID inside the bold.
The ID is what matters, not how it is emphasized, so the pattern accepts either — and
whichever form a doc uses, **preserve it**. Read each requirement's actual prefix from
the doc and reuse that exact text when anchoring or writing; never normalize one style
to the other, since rewriting a prefix edits requirement text the user never asked to
change.

Requirements may also be split under `###` subsection headings inside
`## Requirements` (one older doc groups its twelve requirements under two). Those
headings are **not** walk stops and get no verdict — walk the `R`-bullets beneath them
in doc order, exactly as if the headings were not there. Render a heading as context
when you first reach a requirement under it, so the user sees which group they are in.

Detection is **structural**, never by the doc's `date:` or by any version marker.

**One or more matches → walk them.** Announce the count briefly:

> "Requirements doc has 12 `R`-bullets — walking them in order."

Note the requirements' order as they appear in the doc. **Doc order is walk order.**
Never reorder, and never renumber.

### 2a. Zero `R`-bullets is a hard stop

If `## Requirements` contains no `R`-IDed bullets in **either** accepted form, **STOP
here** — before the read-only context render of Step 3 and before any write of any
kind. Leave the file byte-identical: no edit, nothing.

This is a **precondition, not a defect**. A requirements doc with plain unnumbered
bullets is legal `/brainstorm` output — that shape is what `/brainstorm` produces for a
doc with only one to three simple requirements. The doc is fine; it just cannot be
walked, because there is no stable ID to anchor review state to or to cite from a later
plan.

Say exactly that, and name the fix:

> "This doc's `## Requirements` bullets aren't `R`-numbered, so there's nothing to
> anchor review state to. That's a legal `/brainstorm` shape for a short doc, not a
> broken file — I've changed nothing. To walk it, number the bullets `R1` … `Rn`
> (`- R1. **Title.** …`) and re-invoke."

**There is no fallback mode.** This is a deliberate divergence from `/blueprint-walk`,
which degrades to a read-only section-by-section walk when a plan has no units. The
divergence is intentional: a plan without units is an *old-shape* artifact that will
never be regenerated, so a degraded walk is the only walk it will ever get, whereas an
unnumbered requirements doc is a *current-shape* artifact one edit away from being
fully walkable. Offering a degraded walk here would hide the one-line fix. Do not
degrade, and do not offer a read-only walk as a consolation.

## Step 3: Render the Read-Only Context

Once the precondition passes, print the doc's non-requirement sections **once**, before
the first requirement, as orientation. Render each present section's body **verbatim**
and label the whole block read-only:

> "Context (read-only — these sections get no verdict and are never edited):"

Render, in this order, only those that exist in the doc:

- `## Problem Frame`
- `## Success Criteria`
- `## Scope Boundaries`
- `## Key Decisions`
- `## Dependencies / Assumptions`
- `## Outstanding Questions`

**A missing section is the normal case.** `## Dependencies / Assumptions` is absent
from several existing docs and its absence carries no meaning. Omit it silently — do
not note the gap, do not ask about it, and above all never fabricate a section or
infer its contents from the rest of the doc.

`## Next Steps` and the YAML frontmatter are not rendered; they describe what happens
after the doc, not what the doc asks for.

These sections are context for the walk and nothing more. They receive no verdict, they
are never written to, and they are never edited **even when a verdict makes one of them
stale** — retiring a requirement can leave a Success Criterion dangling, and that is
left for the human to reconcile.

## Step 4: Detect the Resume Point

Parse every requirement's `**Reviewed:**` line (requirements without one are
unreviewed). Decide where to start:

1. If any requirement is `**Reviewed:** pending`, **resume there** — a previous walk
   was interrupted after claiming the requirement but before recording a verdict.
   Announce:
   > "Resuming at R4 (last left pending)."
   If more than one requirement is `pending`, resume at the **first** in doc order and
   say so.

   A `pending` requirement takes the entry point even when earlier requirements are
   non-terminal — finishing the interrupted verdict comes first. **Those earlier
   requirements are not abandoned:** after the `pending` requirement gets its verdict,
   fall back to rule 2 and continue from the first non-terminal requirement in doc
   order, which walks back to them. The walk is over when rule 3 holds, never when the
   last requirement is reached.
2. Else, the entry point is the first non-terminal requirement in doc order. Terminal
   values are `accepted`, `modified`, `retired`, `skipped`. A missing `**Reviewed:**`
   line is non-terminal, and so is `pending`.
3. If every requirement is terminal, report completion and exit — jump straight to the
   final summary:
   > "Walk already complete. All N requirements are accepted / modified / retired /
   > skipped."

### 4a. Where the state line lives

`**Reviewed:**` sits on a **two-space-indented continuation line inside the `R`-bullet's
own list item**, after the requirement's last line — sub-bullets included:

```
- R4. **Related entry contents.** Each entry contains:
  - PR number + link (required)
  - No review links.
  **Reviewed:** `accepted`
```

This is not cosmetic and it is not the shape the other two walks use. `/blueprint-walk`
anchors state under a `- [ ] **Unit N:` heading and `/review-walk` under a `### P1-3:`
heading; both of those have a body beneath them, so an unindented state line sits
naturally in it. An `- Rn.` bullet has **no body** — it is a single list item, and an
unindented line placed after it terminates the list, splitting `## Requirements` into
two lists and orphaning every requirement below the insertion point. The indent is what
keeps the state line part of its own bullet.

So when parsing: match `**Reviewed:**` as an **indented continuation of a bullet**, not
as a standalone line under a heading, and associate each one with the nearest preceding
`R`-IDed bullet — that bullet owns it. Note that requirement **sub-bullets are indented
two spaces too**, so indentation alone does not distinguish a state line from a
sub-bullet; the `**Reviewed:**` label is what identifies it.

The `**Reviewed:**` field is the *only* review-state store. Never encode review state in
the requirement's own text, and never in a checkbox — `- Rn.` bullets have none, and
adding one would change the doc's shape for `/blueprint`.

## Step 5: Walk the Requirements

For each non-terminal requirement, in doc order:

### 5a. Render the requirement verbatim

Show the requirement **exactly as written** in the doc — its `- Rn.` line, its bolded
title if it has one, and **every sub-bullet indented beneath it**. Sub-bullets are part
of the requirement, not decoration: several requirements carry three to six of them and
that is where the actual specification often lives. Rendering the `- Rn.` line alone
and dropping what follows is a silent truncation, and the user would be giving a
verdict on text they were never shown.

Never fabricate, summarize, reflow, or trim requirement text at render time. If the
current `**Reviewed:**` state is present, show it too.

### 5b. Teach the requirement

Compose a plain-English explanation of what this requirement is actually asking for:

- Lead with the point in non-jargon terms (e.g. "This one says the walk has to survive
  being interrupted — it writes a marker into the doc before it changes anything, so a
  crash is distinguishable from a clean start.").
- Say why it exists — what breaks or stays broken without it.
- Name what it depends on or interacts with elsewhere in the doc, and what that buys.
- Keep it to **3–6 sentences**. The goal is comprehension, not a lecture.

Explain from the **doc text alone**. **Do not read code the requirement cites.** A
requirements doc describes behavior that does not exist yet — the cited file is either
absent or shows only the pre-change state, so reading it buys nothing and costs walk
momentum. The read-only context from Step 3 is the supporting material; use that. If a
requirement is genuinely unexplainable from its own text plus that context, say so
plainly rather than inventing context.

### 5c. Ask the action question

Ask via `AskUserQuestion`:

- **Accept** — the requirement is right as written; mark it reviewed and advance.
- **Modify** — something is wrong; describe it, and the skill drafts a replacement.
- **Remove** — this requirement should not be built; retire it in place.
- **Add term** — capture an unfamiliar concept to the glossary. **Does not advance the
  requirement** — the menu is re-asked afterward, and review state is untouched.
- **Skip** — no verdict now; move on. Reported at the end as *unreviewed*, never as
  accepted.

Ask this question for **every** requirement, one at a time. Never collapse several
requirements into one question, and never offer a batch verdict — not even when the
remaining requirements look alike.

`Add term` (and any request for a deeper explanation) is a **self-loop**: handle it,
then re-ask this same question on the same requirement. Both are repeatable any number
of times on one requirement. That is the entire point of the side-buffer — learning
must not cost the review thread.

Then execute the chosen action using the Review-State Write Protocol (Step 6).

## Step 6: Review-State Write Protocol

The requirements doc is the durable progress store. Every advancing action writes a
`**Reviewed:**` line into the requirement using `Edit`.

The written block sits on a **two-space-indented continuation line after the
requirement's last line — sub-bullets included** (Step 4a explains why the indent is
load-bearing: an unindented line terminates the list and splits `## Requirements` in
two). `**Review note:**` sits directly beneath `**Reviewed:**` with **no** blank line
between them — they are one block, both at the same two-space indent:

```
- R4. **Related entry contents.** Each entry contains:
  - PR number + link (required)
  - No review links.
  **Reviewed:** `modified`
  **Review note:** dropped the third sub-bullet — it duplicated R2
```

Unlike `/blueprint-walk`, there are **no blank lines around the block**. A blank line
before it would end the list item just as surely as an unindented line would. The state
block is the last thing inside the bullet and touches the line above it.

`**Reviewed:**` takes exactly one of: `pending`, `accepted`, `modified`, `retired`,
`skipped`.

### 6a. Anchoring rule (mandatory)

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#anchoring) — it owns the
match-count check, the required `--`, the read-the-printed-count rule, and the
stop-on-ambiguity rule. Every `Edit` in this step runs it, without exception.

This walk's unique identifier is the `R`-ID. Both `- R7. ` and `- **R7.** ` are live in the corpus; a doc keeps whichever form it uses, so the anchor is copied from that doc's own prefix rather than normalized.

### 6b. Re-read before every write

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#re-read-before-every-write).
Build every anchor from the fresh read of the requirement's current on-disk text, never from
the text captured when it was rendered.

### 6c. Claim the requirement first

The **first** write on any requirement sets `**Reviewed:** pending` — before any other
mutation, and before the destructive actions do anything. A requirement
left `pending` is unambiguously "a walk started here and did not finish", which is
exactly what Step 4 resumes on.

Append it as an indented continuation line after the requirement's **last** line:

```
- R7. **Status writes.** Use `/review-walk`'s vocabulary:
  - `in-progress` before an edit, `done` after.
```
→
```
- R7. **Status writes.** Use `/review-walk`'s vocabulary:
  - `in-progress` before an edit, `done` after.
  **Reviewed:** `pending`
```

Anchor the `Edit` on the requirement's ID-bearing line *plus* every sub-bullet down to
the last one. Anchoring on the `- Rn.` line alone leaves the insertion point ambiguous —
the state line would land above the sub-bullets, and the next write would not find the
shape it expects.

If the requirement already carries a `**Reviewed:**` line (a re-walk), edit its value in
place rather than inserting a second one.

**6a and 6b bind every action below, without exception.** Each of the five actions
writes through the same protocol: build the anchor from a fresh read (6b), run 6a's
match-count check, then `Edit`. The two destructive actions repeat that instruction at
their own write sites because they write twice; the others say it once, here. There is
no backup — the match-count check is the only thing standing between a mis-built anchor
and a corrupted doc, so it is never optional.

### 6d. Accept

1. Set `**Reviewed:** accepted`.
2. No note required. If the user volunteers one, add `**Review note:** <text>` on the
   indented line below.
3. Advance to the next requirement.

### 6e. Modify

Modify is **destructive** — it replaces doc text that is not in git. Follow
[the walk-protocol spec](../walk-protocol/SKILL.md#destructive-actions) exactly: ask
what is wrong, claim the requirement (6c), draft the replacement, edit only the changed
span while carrying untouched text through byte-identical, show a labelled
before/after, and confirm **Apply** / **Revise** / **Cancel** before any write.

On Apply, set `**Reviewed:** modified` with a required `**Review note:**` recording what
changed and why. Never renumber the requirement and never change its `R`-ID.

### 6f. Remove

Remove is **equally destructive** as modify and gets the same confirmation weight. Do
not treat it as the lighter action.

1. Ask the user why the requirement should not be built.
2. Claim the requirement `pending` (6c).
3. **Tombstone in place — never delete the bullet, never renumber.** Requirements
   cross-reference each other by ID, plans cite them in `**Requirements:**` fields, and
   issue stamps carry those citations. Deleting the bullet or shifting IDs invalidates
   all three. The requirement keeps its position, its `R`-ID, and its full text.

   The tombstone is a strikethrough of the requirement's **descriptive text only**, plus
   the state block:

   ```
   - R7. ~~**Status writes.** Use `/review-walk`'s vocabulary so downstream skills work unchanged.~~
     **Reviewed:** `retired`
     **Review note:** retired — folded into R3; cited by R11 and by Success Criteria, neither updated
   ```

   **The `~~` markers open after the `R`-ID prefix and close at the end of the
   requirement text — never around the whole line.** On a bare-form doc the prefix
   `- R7. ` stays outside the strikethrough; on a bold-form doc `- **R7.** ` does. This
   is not cosmetic: 6a anchors on that prefix, and wrapping the line as
   `- ~~R7. …~~` would put a `~` between the `- ` and the `R`, so every later
   match-count check for `- R7. ` returns 0 and the walk can no longer find its own
   tombstone. `/blueprint-walk` solves the same problem by appending its `~~RETIRED~~`
   marker *after* the heading text (6f there); the constraint is identical — the
   ordinal-bearing anchor text must survive the tombstone byte-for-byte.

   For a requirement with sub-bullets, strike each sub-bullet's own text the same way,
   leaving the `  - ` list punctuation outside the markers, and put the state block after
   the last one.

   Do not comment out, blank, or delete the text. A retired requirement still has to be
   readable to explain why it was retired, and `/blueprint` must still be able to see
   that the ID exists.
4. **Scan for citations.** Search the doc for other requirements or sections naming this
   ID:

   ```bash
   grep -n -E 'R7\b' docs/brainstorms/<file>.md | grep -v -E '^[0-9]+:- (\*\*)?R7\.'
   ```

   **Discard the self-match.** The requirement's own `- R7.` bullet contains its ID, so
   an unfiltered scan always returns at least one hit and every retirement would report
   a citation that does not exist. The second `grep` drops that line; if you run the
   scan without it, discard the requirement's own bullet by hand before counting. A
   requirement cited nowhere must produce **zero** hits, or the count written into the
   review note is wrong — and that note is durable, read later by a human and by
   `/blueprint`.

   Read the remaining hits, and read them rather than counting them: `R1` also matches
   inside prose like `R1…Rn`, which is not a citation either.

   **Never auto-edit another requirement, and never edit a non-`R` section** — a retired
   requirement can leave a Success Criterion or a Scope Boundary dangling, and
   reconciling that is the human's call, not the walk's. Citation handling is warn-only.
5. Show a **before/after** of the tombstoned bullet and ask via `AskUserQuestion`:
   **Retire** / **Cancel**. On Cancel, restore the prior `**Reviewed:**` state and change
   nothing else.
6. On **Retire**: run the 6a match-count check, re-read (6b), apply the `Edit`, set
   `**Reviewed:** retired` and a required `**Review note:**` recording the reason — **and,
   when anything else cites the ID, those citations, durably in that note**:

   ```
   **Reviewed:** `retired`
   **Review note:** retired — folded into R3; cited by R11 and by Success Criteria, neither updated
   ```

   A terminal warning disappears at the end of the session; the note is what a later
   reader of the doc — or `/blueprint` consuming it — actually sees.

### 6g. Add term

1. Capture the term to the glossary (Step 7).
2. **Do not touch `**Reviewed:**`.** No state change of any kind.
3. Re-ask the Step 5c action question on the same requirement. Repeatable.

### 6h. Skip

1. Set `**Reviewed:** skipped`. No note required; record one if the user offers.
2. Change nothing else in the requirement.
3. Advance. Skipped requirements are reported at walk end as **unreviewed** — never
   folded into accepted.

## Step 7: Capture a Term to the Glossary

Where `Add term` (6h) routes. Follow
[the walk-protocol spec](../walk-protocol/SKILL.md#capturing-a-term) exactly — it owns
the side-buffer contract, the one-answer flow, and the delegation to `/term-add` in
quiet mode. Re-ask the Step 5c action question on the same requirement afterward.

## Step 8: Finish the Walk

Reached when every requirement is terminal — either walked through in this session or
already terminal when Step 4 checked — or when the user ends the walk early. An early
end still runs 8a: the counts are derived from the doc, so a partial walk reports
truthfully rather than not at all, with the unwalked requirements falling into the
never-reached and left-pending buckets.

### 8a. Report the Summary

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#the-summary) — it owns the
re-read-from-disk rule, the bucket set, and the requirement that the buckets sum to the
doc's total requirement count.

Read the state lines with:

```bash
grep -n -E '^\s+\*\*Reviewed:\*\*' docs/brainstorms/<file>.md
```

The grep requires the leading indent: state lines are indented continuations inside their bullet, and the unindented `**Reviewed:**` that appears in some docs' prose is not one.

This walk's terminal verdicts are **accepted / modified / retired**; `skipped` reports as *unreviewed*.

Example shape:

> "Walk complete — 12 requirements: 7 accepted, 2 modified, 1 retired, 1 skipped
> (unreviewed), 1 never reached. 1 retired requirement is still cited elsewhere in the
> doc — see its review note. 3 terms captured to `~/.claude/glossary.md`."

### 8b. Stamp the Walk Outcome

The stamp fires only here, at final summary — a walk that dies without reaching Step 8
(a crash, a closed session) posts nothing, and a resumed walk stamps only when it reaches
this step. A walk the user deliberately ends early *does* reach Step 8, so it stamps,
with the unwalked requirements counted in the unreviewed line. Counts come from 8a, so
they describe the whole doc rather than this session's slice. Issue-number resolution
(including the silent skip when none resolves), posting mechanics, marker encoding, and
failure handling are defined in [the issue-log spec](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"brainstorm-walk","event":"brainstorm-walk-complete","paths":["docs/brainstorms/<file>.md"]} -->

### 🚶 /brainstorm-walk — walk complete

**Summary:** <n> requirements walked — <n> accepted, <n> modified, <n> retired, <n> skipped
**Unreviewed:** <n> skipped, <n> never reached, <n> left pending
**Retired still cited:** <n> — <R4, R7> named elsewhere in the doc
**Terms added:** <n> — <term, term, term>
```

```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

Omit `**Retired still cited:**` when nothing was retired or nothing cites what was, and
omit `**Terms added:**` when no term was captured. There is no `**Doc:**` field — the
walk produces no document of its own, and the walked doc's path rides in `paths`.

## Rules

- **Never write code and never plan the requirements.** That is `/blueprint`. This skill
  only reads requirements docs, edits their review state, and delegates term capture to
  `/term-add`.
- **Walk order is fixed and every requirement is presented individually.** Doc order is
  the walk's order: start at the resume point and advance one requirement at a time, never
  reordering and never letting the user pick where to start. **Never offer to batch** —
  no "accept all of these?", no verdict spanning several requirements, no bundling behind one
  question. Each requirement gets its own render, its own teach moment, and its own action
  question, even when every requirement has the same obvious answer and the batch would be
  faster. The walk exists so each requirement is actually looked at; a shortcut that skips
  presentation defeats the point of running it.
- **Never renumber, reorder, or delete a requirement**, and never add one. `R`-IDs are
  load-bearing: other requirements cite them, plans cite them in `**Requirements:**`
  fields, and issue stamps carry those citations forward.
- **Never normalize an `R`-ID prefix.** Both `- R7.` and `- **R7.**` are legal; a doc
  keeps whichever it uses, and anchors are built from the doc's own text (6a).
- **Never edit a non-`R` section**, even when a verdict makes one stale. Retiring a
  requirement can leave a Success Criterion or a Scope Boundary dangling; that is the
  human's to reconcile.
- **Never fabricate a missing section.** An absent `## Dependencies / Assumptions` is
  normal. Render what exists; never infer the rest.
- **Never modify or retire without the before/after confirm.** Both actions destroy text
  that is not in git. The user sees old and new, labeled, and says apply.
- **Stop the walk on an ambiguous anchor.** More than one match for an `Edit` anchor
  means refusing to write and surfacing it (6a). Never guess which match is right.
- **The requirements doc is the source of truth.** If the user edits it between turns,
  re-read before the next action so the change is picked up — and rebuild every anchor
  from that read.
- **Skipped is not accepted.** A skip records `skipped` and is reported as unreviewed at
  walk end.
