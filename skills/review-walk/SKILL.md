---
name: review-walk
description: >
  Walk through a code-review document interactively, one finding at a time in
  P1 → P2 → P3 order. Reads a review file produced by /deep-review or /quick-review,
  renders each finding as a compact card (category, files, confidence, one-sentence
  problem, one-sentence fix per option), then takes implement / defer / won't fix /
  add term / explain — or free text. Defer files a tracking issue through
  /issue-from-context; won't fix records a coded reason. `Status:` is updated inline
  in the doc so progress is durable and resumable. Triggers on phrases like "walk the
  review", "step through the review", "review-walk", or passing a path to a
  docs/reviews/*.md file.
user-invocable: true
argument-hint: "[path to docs/reviews/*.md]"
allowed-tools: Bash, Read, Edit, Write, Agent, Skill
---

# Review Walk

Step a human through a code-review document one finding at a time. The review document
is the source of truth — `Status:` updates live in the doc, so walks resume cleanly
across sessions.

This skill **consumes** review docs produced by `/deep-review` or `/quick-review`. It does
not run reviewers or produce new findings. It follows
[the walk-protocol spec](../walk-protocol/SKILL.md) for order, resume, the action
self-loop contract, edit anchoring, and term capture; only what is specific to a review
doc is written here.

**Invoking the walk is the confirmation.** There is no "proceed?" prompt, no "ready?"
prompt, and no per-group gate. The walk never calls `AskUserQuestion`: every question is a
plain-text numbered list the user answers with a number.

## Step 1: Resolve the Doc Path

- If the user passed a path, use it. Verify the file exists with `ls`.
- If no path was passed, auto-discover the newest review doc:

  ```bash
  ls docs/reviews/*.md 2>/dev/null | sort | tail -1
  ```

  The filename convention is `YYYY-MM-DD-NNN-<slug>-review.md`, so a lexicographic
  sort picks the most recent doc deterministically.

- If no review docs exist, STOP and tell the user to run `/deep-review` or `/quick-review` first.
- State the resolved path in one line and continue. Do not ask.

## Step 2: Read the Doc and Find the Resume Point

Read the full review doc. Walk order is `P1-* → P2-* → P3-*` in numeric order,
always.

Parse every finding's `Status:` line:

1. If any finding is `Status: in-progress`, **resume there** — a previous walk was
   interrupted mid-fix. Say so in one line.

   **An `in-progress` finding carrying a `**Sweep:**` or `**Grind:**` line was left by an
   unattended run, not by a walk** — a half-applied edit may already be in the working tree.
   Say so on the card, show what that run claimed it was doing, and let the user look at the
   tree first. Never write `**Applied:**` over it on a later Implement: that field records
   what *this walk* changed, and the walk did not make those edits.
2. Else, start at the first non-terminal finding in walk order. Terminal statuses are
   `done`, `deferred`, `wont-fix`. `open` is non-terminal.
3. If every finding is terminal, report completion and exit:
   > "Walk already complete. N findings — n done / n deferred / n wont-fix."

Open with one line — `Walking <path>: N findings, n remaining.` — then render the first card.

## Step 3: The Card

Every finding gets exactly this card.

```
### P<X>-<N>: <title>
Category: <category>  ·  Confidence: <high | medium | low — <rationale>>
Files:
- <path>
- <path>
Sweep: <reason>            ← only when the doc carries a Sweep: or Grind: line
Problem: <one sentence>
Concept: <one sentence>
Fix: <one sentence — why this fix>

1. implement
2. defer
3. wont-fix
4. term <x>
5. explain
— or just tell me
```

Rules per line:

- **Title line** — the finding's heading, verbatim. The ID appears once, here, and nowhere
  else on the card.
- **Category / Confidence** — copied from the doc's fields. Show the `Confidence rationale:`
  only for `low`. Omit either field when the doc does not carry it; never fabricate one.
- **Files** — always a hyphenated list, one path per line, even for a single file. Union of
  the doc's `File(s):` and any other path the `Fix:` names as something to change. Tangential
  files count; the list is every file this finding touches.
- **Sweep / Grind** — one sentence, only when present: why the unattended run left this
  for a human, rewritten from the doc's `Sweep:` or `Grind:` line rather than pasted.
- **Problem** — one sentence, written from `Plain English:` and `Problem:`. The finding's
  TLDR, aimed squarely at this code: what is wrong, where.
- **Concept** — one sentence naming the general principle this finding is an instance of,
  said the way you would tell a colleague what kind of problem it is without pointing at
  the code. Name the pattern, the engineering principle, or the computer-science idea
  behind it — "a race condition: two writers touch the same state and the last one wins",
  "a leaky abstraction: callers have to know how the helper works to use it safely",
  "single source of truth: the same rule is defined in two places, so they drift." The
  Problem line is about *this* bug; the Concept line is about the *kind* of bug, and is
  what a newer engineer learns from. Never restate the Problem line. When the finding is
  too mundane to have a principle behind it (a typo, a stale comment), omit the line
  rather than invent one.
- **Fix** — one sentence when the doc describes one remedy. When `Fix:` (or `Problem:`)
  describes more than one, letter them `A.`, `B.`, …, one sentence each, and end each with
  **why that fix on its own terms** — a precedent in the codebase, the standard practice,
  the smallest blast radius. No comparison between options, no pros and cons; each line
  justifies itself in its own context. Letters, never numbers: numbered options run into the
  numbered action list and render as one Markdown list, renumbering the actions.

  ```
  Fix:
  A. <one sentence> — <why this one>
  B. <one sentence> — <why this one>
  ```

**Every summary sentence on the card — Sweep, Problem, Concept, each Fix — follows
[`/tldr`'s rules](../tldr/SKILL.md) with N = 1.** Short common words over long ones,
active voice, a concrete subject: "the check runs too early" beats "there is a temporal
ordering issue with the validation invocation." Drop hedging and background, never facts.
Identifiers, error strings, and file paths are kept exact and never paraphrased; any other
term is said in ordinary words. One sentence is the ceiling, not a target.

- **The action list** is plain text, never `AskUserQuestion`, with a blank line above it so
  it stands apart from the card. The user answers with the number (`1`–`5`), the verb, or
  either with a qualifier (`1 but keep the old name`, `3 2` for won't-fix reason 2,
  `4 race condition`), or something else entirely.

Then stop and wait for the reply.

## Step 4: Reading the Reply

Map the reply to one action:

| Reply | Action |
|-------|--------|
| `1`, `implement`, `do it`, `fix`, or instructions describing a change | **Implement** (§5). Instructions that modify the fix are followed — the user is choosing the code, not the walk. When the card has more than one Fix option, the reply names it by letter after the action (`1 B` = implement option B); bare `1` → ask which, in one line of text, and wait. |
| `2`, `defer`, `issue`, `file it`, `later` | **Defer** (§5). |
| `3`, `wont-fix`, `won't fix`, `skip`, `no`, optionally followed by a reason number | **Won't fix** (§5). A reason given in the reply pre-answers the reason question. |
| `4 <x>`, `term <x>`, `add term`, `what is <x>` | **Add term** (§5). Self-loop. |
| `5`, `explain`, `why`, `more`, a question about the finding | **Explain** (§5). Self-loop. |
| anything else | The "just tell me" path: the user is giving direction or asking something the verbs don't cover. Answer it in as few sentences as it needs and re-show the action line. Self-loop. |

**Every finding is presented individually and gets its own reply.** Never collapse several
findings into one card, never offer a batch verdict, never skip a card because the answer
looks obvious. The walk exists so each finding is looked at.

## Step 5: Actions

The review doc is the durable progress store. Every advancing action mutates the finding's
`Status:` line with `Edit`, anchored per the **Edit anchoring rule** below.

### Implement

1. **Before touching code**, set `Status: in-progress` so a crash leaves clear state.
2. Apply the fix. If the user picked a lettered option or gave instructions, follow those;
   otherwise follow the doc's `Fix:`. Do not invent scope. If the fix is unclear, ask in one
   line of text before editing.
3. Set `Status: done` and append an `Applied:` line directly below it:

   ```
     **Status:** `done`
     **Applied:** <as-written | reworked | partial> — <one line: what changed, and what differed from `Fix:` if anything>
   ```

   - `as-written` — the `Fix:` was applied as described. Cosmetic deviation (identifier
     names, import position, reworded comments, an equivalent expression) stays `as-written`.
   - `reworked` — the problem was fixed by a materially different change: a different
     function, file, or algorithm than `Fix:` named, a different remedy, a scope `Fix:` did
     not describe, or the user's own instructions.
   - `partial` — only part of `Fix:` landed; say which part did not and why.

   You made the edit, so you pick the code — never ask the user for it.
4. One line to the user: what changed, in which file(s). Then the next card.

### Defer

Defer means one thing: **file a tracking issue now.** Only the user can defer, and choosing
it is the explicit instruction to create the issue — no second "file it?" prompt from the
walk. There is no defer-reason question.

1. Set `Status: in-progress` (claim).
2. Invoke [`/issue-from-context`](../issue-from-context/SKILL.md) with the finding as the
   framing lens: its heading, `Problem:`, `Fix:`, and `File(s):`. That skill owns the
   title, the body, the label, and its own preview-and-confirm; the walk adds nothing to
   the issue. If the user cancels inside `/issue-from-context`, reset `Status:` to `open`
   and re-show the action line — a cancelled issue is not a deferral.
3. On success, set `Status: deferred` and append the tracking line directly below it:

   ```
     **Status:** `deferred`
     **Tracking:** <owner>/<repo>#<n>
   ```

   No `Defer reason:` line — the issue is the reason. (`/grind` still writes
   `Defer reason:` in the shape defined under **Skip reason format**; it is unattended and files
   nothing, so its reason is the only record. The walk's is the issue.)
4. Do not modify code. One line to the user with the issue URL, then the next card.

### Won't fix

Terminal: this is a decision, not a deferral. The reason code is the one piece of
structured data the walk collects deliberately — it is what later mining of review docs
uses to make `/review-sweep` more autonomous — so it is asked as a plain-text numbered list,
unless the user's reply already carried the number (`3 2`, `wont-fix duplicate P2-3`):

```
Why won't-fix?

1. misread          5. pre-existing
2. by-design        6. already-fixed
3. not-worth-it     7. duplicate <P#>
4. accepted-risk    8. tracked-elsewhere
```

Render it in a fenced block so the two columns keep their alignment.

- **misread** — the reviewer got the code wrong; the problem is not there
- **by-design** — the behavior is intentional
- **not-worth-it** — real, but the fix is out of proportion to the problem
- **accepted-risk** — real and understood; consciously carried as-is
- **pre-existing** — real, but not introduced by this change
- **already-fixed** — real, but no longer present: fixed by another finding's implementation, a later commit, or code that has since been removed
- **duplicate** — the same finding as another in this doc; name it (`7 P2-3` → `duplicate — same as P2-3`)
- **tracked-elsewhere** — already covered by an issue, a plan, or an idea doc
- **protected-artifact** — the fix would delete or gitignore a protected file (see Rules).
  Automatic, never offered on the line.

**The answer is one of these eight, and nothing else.** A number or the full code, optionally
followed by a note (`3 too small to matter`). A reply that starts with none of the eight
is not a reason — re-show the list and wait; never guess a code from prose, and there is no
`other`.

Then set `Status: wont-fix` and append the reason directly below it:

```
  **Status:** `wont-fix`
  **Skip reason:** <code> — <free text>
```

Do not modify code. Next card.

### Add term

Follow [the walk-protocol spec](../walk-protocol/SKILL.md#capturing-a-term) exactly —
it owns the side-buffer contract, the one-answer flow, and the delegation to `/term-add`
in quiet mode. `Status:` and code are untouched. Re-show the action line on the same
finding.

### Explain

Read the cited files (the card's `Files:` list, anchored at the finding's line numbers)
and answer in **at most three sentences**, under [`/tldr`'s rules](../tldr/SKILL.md) with
N = 3: what the code does today, why that is a problem, and the Concept line expanded —
where the principle comes from or how to spot it next time. Pick the three that matter
most; a quoted line of code does not count against the cap. If the user asks again, answer
the new question in three more. `Status:` untouched. Re-show the action line on the same
finding.

### Skip reason format

`Skip reason:` is `<code> — <free text>`, one line, directly under `Status:`
(`/grind`'s `Defer reason:` borrows the same shape).

**These code lists are the whole convention, not just this walk's.** `/review-sweep` writes
`Skip reason:` with two of the codes (`misread`, `protected-artifact`); `/grind` writes both
fields with the full lists. One field, one vocabulary, whoever wrote it, so the codes stay
countable across a pile of review docs. Adding or renaming a code here changes it for all
three; tell the writers apart by the `**Sweep:**` or `**Grind:**` signature line, never by
the code.

- **Skip reason codes** — the won't-fix list above.
- **Defer reason codes** — the walk writes none (it records a `Tracking:` line instead);
  `/grind` is their only writer and [defines them](../grind/SKILL.md#5-triage-and-fix).
- **The code** is the one the user's number names. Then ` — ` and the user's note, kept
  **verbatim**, if they added one; if none, the line is the code alone. Never rewrite,
  shorten, or "improve" what they typed, and never invent a note they did not give.
- **Verbatim means their wording is unchanged — not that the bytes are written unaltered.**
  The reason line sits directly beside the `Status:` line every downstream parser anchors
  on, so before writing it: collapse the text to one line (newlines become spaces) and
  neutralize anything that reads as document structure, exactly as
  [the synthesizer does](../../agents/review/review-synthesizer.md) — indent a
  heading-shaped fragment matching `^#{1,6}\s`, escape code-fence markers, and escape a
  bold-field-label shape matching `^\*\*[A-Za-z ]+:\*\*`. An unescaped `**Status:**` in a
  pasted snippet makes `/review-push` count an extra issue and a sweep re-run read the
  wrong status.

### Edit anchoring rule

Status edits must be unique. Anchor each `Edit` call on the **two lines together**: the
`### P<X>-<N>:` heading line and the `**Status:**` line directly under it (with the blank
line between them included in `old_string`).

```
### P1-3: Missing CSRF check on logout

**Status:** `open`
```

→

```
### P1-3: Missing CSRF check on logout

**Status:** `in-progress`
```

## Step 6: Final Summary

After all findings are terminal:

- Counts by terminal status: `done`, `deferred`, `wont-fix` — one line.
- Deferred findings with their issue URLs, one per line, derived by re-reading the doc's
  `Tracking:` lines — never from session memory.
- **Terms added** — how many terms this session captured to `~/.claude/glossary.md`. This
  one *is* session-scoped: count the confirmation lines from Add term. A capture that
  reported the term was already present counts too. Omit the line when none.
- Stamp the walk outcome (§6a).
- Next step, one line: if any `done` finding changed code, check for an open PR
  (`gh pr view --json state,number`). Open PR → suggest `/review-push`. No PR → `/ship`.

### 6a. Stamp the Walk Outcome

The stamp fires only here — a walk abandoned before Step 6 posts nothing. Statuses come
from the doc's `Status:` lines (`done` → implemented, `deferred` → deferred, `wont-fix` →
skipped), so resumed walks report correctly. Issue-number resolution (including the skip
when none resolves), posting mechanics, marker encoding, and failure handling are defined
in [the issue-log spec](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"review-walk","event":"review-walk-complete","paths":["docs/reviews/<file>.md"],"followup":true} -->

### 🚶 /review-walk — walk complete

**Summary:** <n> issues walked — <n> implemented, <n> deferred, <n> won't fix
**Issues:**
- <P<X>-<N>: short title>
  - <one line on what the issue is>
  - <status>: <why — the Applied: / Skip reason: line, or the Tracking: ref>
**Tracking:** <owner>/<repo>#<n>, one ref per `Tracking:` line in the doc
**Terms added:** <n> — <term, term, term>
```
```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

Enumerate every walked finding, in doc order. Include `"followup":true` and the
`**Tracking:**` line only when at least one finding is `deferred`; omit both otherwise.
Omit `**Terms added:**` when no term was captured.

There is no `**Doc:**` field — the walk produces no document of its own, and the walked
review doc's path rides in `paths`.

## Rules

- Never edit code without setting `Status: in-progress` first.
- Never fabricate `Confidence:` or `Category:` when the doc lacks them; omit the field.
- Never skip the user's chosen action (don't "implement" when they said "defer").
- **Walk order is fixed: `P1-* → P2-* → P3-*`, every finding on its own card with its own
  reply.** Never reorder, never batch, never offer a group-level verdict.
- **Add term and Explain never advance the walk.** They touch neither `Status:` nor code.
- **Only the user defers, and defer always files an issue.** The walk never defers on its
  own, and never files an issue except as the user's chosen Defer action.
- Respect the Protected Artifacts rule from `/deep-review`: never apply a fix that would
  delete or gitignore files under `docs/brainstorms/`, `docs/plans/`, or
  `docs/solutions/`. Such a finding is automatic `wont-fix — protected-artifact`; say so.
