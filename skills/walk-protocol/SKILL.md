---
name: walk-protocol
description: >
  Shared specification for the three walk skills — brainstorm-walk, blueprint-walk, and
  review-walk. Owns the rules every walk obeys identically: walk order, the action
  self-loop contract, the edit-anchoring and re-read discipline, the claim-first rule,
  the term-capture side buffer, and the summary-and-stamp shape. Not user-invocable;
  the walks cite it and restate none of it.
user-invocable: false
disable-model-invocation: true
---

# Walk Protocol Specification (v1)

Three skills walk a document interactively, one item at a time, recording verdicts
inline so the walk resumes across sessions:

| Skill | Artifact | Item | State field |
|---|---|---|---|
| [`brainstorm-walk`](../brainstorm-walk/SKILL.md) | `docs/brainstorms/*-requirements.md` | `R`-bullet | `**Reviewed:**` |
| [`blueprint-walk`](../blueprint-walk/SKILL.md) | `docs/plans/*.md` | implementation unit | `**Reviewed:**` |
| [`review-walk`](../review-walk/SKILL.md) | `docs/reviews/*.md` | finding | `**Status:**` |

This file is the single source of truth for every rule that applies to more than one
of them. Walk skills embed only their own artifact-specific prose — path resolution,
shape detection, how an item is rendered, where the state line sits, what the action
verbs are — and reference this spec for everything below. **Never restate a rule from
this file inside a walk**, not even paraphrased; a rule that drifts between three files
is worse than a rule stated once.

Throughout, **item** means whatever that walk walks, and **doc** means the artifact it
walks.

## Walk order

**Order is fixed and never negotiated.** Items are walked in document order, starting
at the resume point. Never reorder, never renumber, and never ask the user which item
or group to start from. A walk whose items are grouped runs the groups in document
order and each group's members in the order the group names.

**Every item is presented individually.** Each one gets its own render, its own teach
moment where the walk has one, and its own action question. **Never offer to batch** —
no "accept all of these?", no verdict spanning several items, no bundling behind a
single question — even when every remaining item has the same obvious answer and the
batch would be faster. The walk exists so each item is actually looked at; a shortcut
that skips presentation defeats the point of running it.

Items already carrying a terminal verdict are passed over silently, not offered.

## Resume

The state field written into the doc is the **only** progress store. Never track
progress in session memory, and never use a checkbox — other skills own those.

On every invocation, parse each item's state and pick the entry point:

1. Any item in the walk's **claimed-but-unfinished** state (`pending`, or
   `in-progress` where that is the walk's name for it) is resumed first — a previous
   walk claimed it and died before recording a verdict. If several are claimed, resume
   at the first in document order and say so.
2. Otherwise, start at the first item whose state is non-terminal. A missing state line
   is non-terminal.
3. If every item is terminal, report completion and exit without re-walking.

After finishing a claimed item, fall back to rule 2 rather than assuming the walk is
over — earlier non-terminal items are not abandoned. The walk ends when rule 3 holds,
never when the last item is reached.

## The action question

Each walk defines its own verbs, because the artifacts differ: a requirement or a unit
is a **thing to build** and is accepted, modified, or removed; a review finding is a
**proposed fix** and is implemented, deferred, or declined. What is shared is the
shape:

- Every walk offers **add term**, and it behaves identically in all three.
- Actions are either **advancing** (they record a verdict and move to the next item) or
  **self-loops**.
- **A self-loop changes no state.** It does its work, then re-asks the same action
  question on the same item. It never writes the state field, never edits code or the
  doc, and is repeatable any number of times on one item. `add term` is always a
  self-loop; so is any "explain more" action a walk offers.

That is the entire point of the side buffer: learning must not cost the review thread.

**Vocabulary warning.** *Skip* means "no verdict yet, reported as unreviewed" in
`brainstorm-walk` and `blueprint-walk`. `review-walk` has no such action — its
terminal decline is **won't fix**. Never introduce an action named *skip* that closes
an item, and never introduce one named *won't fix* that defers.

## Write protocol

Every state write follows the same discipline, on **every** action without exception —
including the ones whose payload is only a state line. The walks edit gitignored docs;
there is no `git checkout` to recover a mis-targeted write, and the walks keep no
backup, so this discipline is the only guard.

### Anchoring

Every `Edit` anchor must contain the item's unique identifier — the `R`-ID, the unit
ordinal, the finding ID. That identifier is the only token the producing skill
guarantees unique. Two items can share a name, and once both carry the same state value
the anchor text becomes identical in two places: an anchor that reports success while
silently mutating the wrong item.

**Build the anchor from the doc's own text**, copied byte for byte from the fresh read
below — never from a hardcoded or normalized form. Where a doc admits more than one
identifier spelling, whichever the doc uses is the one the anchor must use.

Before **every** `Edit`, count matches for the exact `old_string`:

```bash
grep -c -F -- "<exact anchor text>" <doc path>
```

The `--` is **required**, not stylistic: an anchor beginning with `- ` is otherwise
read as an option bundle, exiting 2 with `invalid option` and printing nothing. Read
the **printed count**, not the presence of output, and treat a non-zero exit alongside
no count as a broken invocation rather than a result — `grep` exits 1 on a clean zero
match (printing `0`) and 2 on a usage error.

- **Exactly 1 match** → proceed with the `Edit`.
- **0 matches** → the doc changed underneath. Re-read, rebuild the anchor, and if it
  still does not match, STOP and show the user expected versus actual.
- **More than 1 match** → **STOP the walk.** Do not edit. Surface the ambiguity and
  never guess which match is right.

### Re-read before every write

Immediately before each `Edit`, read the item's current on-disk text and build the
anchor from *that*, not from the text captured when the item was rendered. The user may
edit the doc in another editor mid-walk; rebuilding closes the window where a stale
anchor either fails or matches something unintended.

### Claim first

The **first** write on any item sets the claimed state, before any other mutation and
before a destructive action does anything. An item left claimed is unambiguously "a
walk started here and did not finish", which is exactly what resume detects.

If the item already carries a state line (a re-walk), edit its value in place rather
than inserting a second one.

### Destructive actions

An action that rewrites or withdraws the doc's own text is **destructive** and is
gated the same way in every walk:

1. Ask the user what is wrong, in their words.
2. Claim the item.
3. **Draft** the replacement. The skill drafts; the user approves. The user is
   reviewing, not authoring.
4. **Edit only the region that changes.** Scope the `Edit` to the smallest span
   containing the change and leave every other field out of `old_string` entirely.
   Text never passed to an `Edit` cannot be corrupted by one. Carry untouched text
   through byte-identical — a regenerated block that quietly drops or rewords a field
   the user never mentioned is silent data loss.
5. Show a **before/after** of the changed region, clearly labeled.
6. Confirm: **Apply** / **Revise** / **Cancel**. On Cancel, leave the text untouched
   and reset the state field to its prior value, removing the claim line entirely if
   there was none before.
7. Only on Apply: run the match-count check, re-read, apply the `Edit`, then write the
   terminal state with its required note.

**Withdrawal tombstones in place.** An item that should not be built keeps its
identifier, its position, and its body; only its state line and a strikethrough mark it
retired. Never delete the block and never renumber — other items cite identifiers, and
issue stamps compose keys from them. **The strikethrough must not touch the identifier
the anchor depends on**: open it after the ID, never around the whole line, or the walk
can no longer find its own tombstone.

**Citations are warn-only.** Scan for other items naming the withdrawn identifier and
record what you find in the item's note — durably, because a terminal warning
disappears at the end of the session. **Never auto-edit another item** to reconcile a
dangling reference; that is the human's call. When scanning, exclude the item's own
line, or every withdrawal reports a citation that does not exist.

## Capturing a term

This is where every walk's `add term` routes. It is a **side buffer**: it writes to one
file outside the repo and touches nothing else. Capturing a term does not write the
state field, does not edit code, and does not advance the item — the doc is not opened
at all. A walk that only captures terms leaves its doc byte-identical.

Speed is the requirement. This runs mid-walk and its entire purpose is to not derail
it, so it costs the user **one answer**:

1. Ask for the term, and nothing else:
   > "What term should I capture?"

2. Follow [term-add](../term-add/SKILL.md) exactly, in
   [quiet mode](../glossary/SKILL.md#quiet-mode), passing that answer as the term. It
   drafts the definition and every other field, writes the entry, and emits its one
   confirmation line — which is the only output the walk shows. A walk adds no glossary
   behavior of its own and defines no part of the entry format.

3. Immediately re-ask the action question on the same item.

Repeatable any number of times on one item. Each capture is independent; nothing is
batched until walk end.

## Finishing

Reached when every item is terminal, or when the user ends the walk early. An early end
still reports: the counts come from the doc, so a partial walk reports truthfully
rather than not at all.

### The summary

**Re-read the doc from disk and derive every count from its state lines.** Never count
from session memory. A walk resumed across sessions has verdicts this session never
rendered, and a user may have hand-edited state between turns; only the doc knows the
whole total.

Bucket every item by its state value, and keep these distinct:

- The **terminal verdicts**, each named separately.
- **Declined-without-verdict** — reported as *unreviewed*, never folded into the
  accepted bucket. The user declined to give a verdict, which is not approval.
- **Never reached** — items carrying no state line at all. Distinct from the above:
  nobody looked at these. Naming them separately is what stops "12 items, 9 accepted"
  from hiding three the walk never showed.
- **Left claimed** — items still in the claimed state. A normal walk finishes with
  none, but a hand-edit or an abandoned earlier walk leaves one.

**The bucket counts must sum to the doc's total item count.** If they do not, a value
is unaccounted for and the summary is wrong.

**Terms added** is the one session-scoped count: the glossary is shared across every
doc the user walks, so a re-read cannot separate this walk's captures from an earlier
walk's. Count the capture confirmation lines. A capture reporting the term was already
present counts too — the user looked it up, which is what the number is for.

Omit a bucket that is zero rather than printing it, but never omit a non-zero one to
keep the sentence short.

### The stamp

The stamp fires **only** at the final summary. A walk that dies before reaching it
posts nothing; a walk the user deliberately ends early does reach it and does stamp,
with the unwalked items counted in the unreviewed line. Counts come from the summary,
so they describe the whole doc rather than this session's slice.

Every walk's marker carries `paths` naming the walked doc. **No walk carries a
`**Doc:**` field** — that field belongs to skills that produce a document, and a walk
produces none; the walked path rides in `paths` instead.

Issue-number resolution (including the silent skip when none resolves), posting
mechanics, marker encoding, and failure posture are defined in
[the issue-log spec](../issue-log/SKILL.md), which each walk cites for its own event.

## Rules every walk inherits

- **Never write code and never execute the doc.** A walk reads its artifact, edits its
  review state, and delegates term capture. Applying a review finding's fix is
  `review-walk`'s own exception, defined there.
- **Never renumber, reorder, delete, or add an item.**
- **Never fabricate a missing field.** An absent optional field is the normal case.
  Render what exists; never infer the rest.
- **Never mutate the doc outside the item being walked.** Sections the walk does not
  own stay untouched even when a verdict makes one stale; reconciling that is the
  human's call.
- **Never act on a destructive action without the before/after confirm.**
- **Stop the walk on an ambiguous anchor.** More than one match means refusing to
  write and surfacing it.
- **The doc is the source of truth.** If the user edits it between turns, re-read
  before the next action and rebuild every anchor from that read.
- **Declining is not approving.** An item the user passed on is reported as
  unreviewed, never folded into a verdict they did not give.
