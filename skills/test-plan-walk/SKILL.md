---
name: test-plan-walk
description: >
  Walk through a test plan interactively, one T-NNN case at a time, before any test runs.
  Reads a docs/tests/*.md document produced by /test-plan or /grind, renders each case as
  a compact card (mode, source, viability, keep rule, what it asserts, why it was kept,
  the kind of test it is, and a recommendation computed when the walk reaches it), then
  takes keep / explain / cut / add term — or free text. Cut records one of nine coded
  reasons. A `**Walk:**` line is written directly under each case's
  heading so progress is durable and resumable. Triggers on phrases like "walk the test
  plan", "which tests can we cut", "review the test plan with me", "test-plan-walk", or
  passing a path to a docs/tests/*.md file.
user-invocable: true
argument-hint: "[path to docs/tests/*.md]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Skill
---

# Test Plan Walk

Step a human through a test plan one `T-NNN` case at a time and record a verdict on each:
keep it, or cut it with a coded reason. The test document is the source of truth — the
`**Walk:**` lines live in the doc, so walks resume cleanly across sessions, and a walked
doc is the record later mining reads to tighten `/test-plan`.

This skill **consumes** test docs. It proposes no cases, writes no test files, and runs
nothing. It follows [the walk-protocol spec](../walk-protocol/SKILL.md) for order, resume,
the action self-loop contract, anchoring, claim-first, term capture, the summary, and the
stamp, and [the test-protocol spec](../test-protocol/SKILL.md) for the document format —
the case block, [the `**Walk:**` grammar](../test-protocol/SKILL.md#the-walk-line),
and [the cut-case rule](../test-protocol/SKILL.md#the-five-status-values). Only what is specific to walking a test plan is written here.

It slots between `/test-plan` and `/test-plan-run` and is optional: an unwalked doc runs
exactly as it does today. It walks before any run, by convention. `/grind` never invokes it.

**Invoking the walk is the confirmation.** There is no "proceed?" prompt. The walk never
calls `AskUserQuestion`: every question is a plain-text numbered list answered with a
number.

## Step 1: Resolve the Doc

1. `git rev-parse --show-toplevel` and `git rev-parse --abbrev-ref HEAD`. Not a git repo,
   or a detached `HEAD`, is a stop.
2. **A path was given** → use it; verify it with `ls`.
   **No path** → auto-discover per
   [the spec's target-match gate](../test-protocol/SKILL.md#the-target-match-gate): the
   newest `docs/tests/*.md` whose `target:` matches the current branch.

   ```bash
   ls "$(git rev-parse --show-toplevel)"/docs/tests/*.md 2>/dev/null | sort -r
   ```

   Read each `target:` newest-first and take the first match. None → stop: "No test plan
   found for `<branch>` in `docs/tests/`. Run `/test-plan` first."
3. Apply [the target-match gate](../test-protocol/SKILL.md#the-target-match-gate) to the
   resolved doc. A mismatch stops before any write, naming both values.
4. Parse every `### T-<NNN>:` block. **Zero `T-NNN` cases** (an empty or revise-only doc)
   → "No `T-NNN` cases in `<path>` — nothing to walk." and exit with no writes and no
   stamp.

`### V-<NNN>:` blocks and the `## Drop List` are never walked, rendered, or edited.

## Step 2: Find the Resume Point

Per [walk-protocol resume](../walk-protocol/SKILL.md#resume). The claimed state is
`**Walk:** pending`; the terminal states are `keep` and `cut`; a case with no `**Walk:**`
line is non-terminal. Walk order is `T-NNN` in document order, per
[walk order](../walk-protocol/SKILL.md#walk-order).

Every case terminal → print the summary per Step 7, then exit without stamping.

Open with one line — `Walking <path>: N cases, n remaining.` — then read the diff (Step 3)
and render the first card.

## Step 3: The Diff and the Existing Tests

Read the branch diff **once per walk**, before the first card:

```bash
base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
git diff "${base:-main}"...HEAD
```

The recommendation and `explain` both draw on it. The repo's existing tests are searched
per case, not up front: `Grep` the test directories (`test/`, `tests/`, `spec/`,
`__tests__/`, and files named `*test*` or `*spec*`) for the identifiers and behavior the
case asserts.

## Step 4: Claim, Recommend, Render

### The recommendation

Computed when the walk reaches the case — never in an up-front pass. Its inputs:

- the case's fields;
- the diff;
- a grep of the existing tests, so `duplicates existing` and
  `library already guarantees it` are reachable;
- every `**Walk:**` verdict already in this doc, so a case an earlier `duplicates case`
  cut named is judged with that in view.

The call is `keep` or `cut — <code>`, using [the cut codes](#the-cut-codes). It is shown on
the card and never written to the doc.

### The claim

Before the card renders, write `**Walk:** pending`, per
[claim first](../walk-protocol/SKILL.md#claim-first) and
[the state-line write](#the-state-line-write).

### The card

```
### T-NNN: <title>
<mode> · <source> · <viability> · keep rule: <label>
Asserts: <one sentence>
Why: <one sentence>
Concept: <one sentence>
Recommendation: <keep | cut — <code>>: <why>

1. keep
2. explain
3. cut
4. term <x>
— or just tell me
```

Rules per line:

- **Title line** — the case's heading, verbatim. The ID appears once, here.
- **Header** — `**Mode:**`, `**Source:**`, `**Viability:**`, and `**Keep rule:**`, copied
  from the doc without their backticks. A field the doc lacks is left out of the line.
- **Asserts** — what the test checks, written from `**Steps:**` and `**Expected result:**`.
- **Why** — written from the case's `**Why:**` field. Omitted when the doc has none.
- **Concept** — the kind of test this is, said the way you would tell a colleague without
  pointing at the code: "a contract test: it pins what callers may rely on, not how the
  function gets there", "a regression guard: it fails if an old bug comes back". Never
  restate the Asserts line. Omitted when the case is too mundane to name a kind.
- **Recommendation** — the call plus why, in one sentence.
- **The action list** — plain text, with a blank line above it. Cut is option 3 because
  that matches `/review-walk`, where option 3 is the "not doing this" slot (`wont-fix`).

**Every summary sentence on the card follows [`/tldr`'s rules](../tldr/SKILL.md) with
N = 1.** Identifiers, error strings, and file paths stay exact. A field missing from the
doc — a pre-`Keep rule:` doc, a case with no `**Why:**` — is omitted, never fabricated, and
the walk proceeds.

Then stop and wait for the reply.

## Step 5: Reading the Reply

Answer with the action's number or word. A code and note after `3` pre-answer the picker,
and a term after `4` pre-answers its question. Anything else gets an answer in as few
sentences as it needs, then the action list again.

There is no skip and no modify: every case ends kept or cut, so the record has no holes,
and the walk judges cases without rewriting them.

## Step 6: Actions

### Keep

Write `**Walk:** keep`. Next card.

### Cut

Show the picker in a fenced block, so the columns keep their alignment, unless the reply
already carried a code:

```
Why cut?

1. pins a constant               6. library already guarantees it
2. asserts a mock                7. duplicates case <T-NNN>
3. duplicates existing           8. implementation detail
4. UI test in fake DOM           9. not worth it
5. tests untouched code
```

The answer is a number or the full code, then the note: `3 tests/test_auth.py covers it`,
`7 T-012 same assertion`. **The note is required** — a code with no note gets a one-line
ask for it. A reply that starts with none of the nine re-shows the picker; never guess a
code from prose, and there is no `other`.

Then write `**Walk:** cut — <code> — <note>`; `Status:` is left as it is. The
note is the user's words, verbatim, collapsed to one line. Next card.

### The cut codes

Codes 1–6 are [the Drop List reasons](../test-protocol/SKILL.md#drop), spelled byte for
byte: a cut with one means the synthesizer had the rule and missed it. Codes 7–9 are
walk-only — a cut with one means the synthesizer lacks a rule: `duplicates case` (another
case in this plan covers it; the note names the `T-NNN`), `implementation detail` (asserts
how, not what; a refactor breaks it), and `not worth it` (real risk, too small for the
test's cost).

### Explain

Answer in **at most three sentences**, under [`/tldr`'s rules](../tldr/SKILL.md) with
N = 3: what the test would look like, what it catches, and what it costs. It may read the
diff and the existing tests. If the user asks again, answer the new question in three
more. No write. Re-show the action list on the same case.

### Add term

Per [walk-protocol term capture](../walk-protocol/SKILL.md#capturing-a-term). A term in
the reply (`4 contract test`) pre-answers its question. Re-show the action list on the
same case.

### The state-line write

The `**Walk:**` line sits directly under the `### T-<NNN>:` heading,
per [the spec](../test-protocol/SKILL.md#case-blocks), so every write is a plain `Edit`
anchored on that heading, per [the write protocol](../walk-protocol/SKILL.md#write-protocol):
re-read the block, count the heading with `grep -c -F -- "### T-<NNN>:" <doc>` (it must
print `1`), then edit only the heading line and the line directly under it. The claim
inserts the line after the heading; a verdict rewrites it in place.
`Status:` and everything below it are never touched.

## Step 7: Finishing

Per [the summary](../walk-protocol/SKILL.md#the-summary), re-read the doc and derive every
count from the `**Walk:**` lines:

- **Buckets** — kept, cut, never reached (no `**Walk:**` line), left pending.
- **Cut codes** — a count per code, one line, e.g. `duplicates existing ×3, not worth it ×1`.
- **Terms added**, as the spec defines it.

Then stamp (§7a) when this session recorded at least one verdict — the already-complete
exit never stamps — and close with one line: `Next: /test-plan-run`.

### 7a. Stamp the Walk Outcome

Per [the stamp](../walk-protocol/SKILL.md#the-stamp); issue-number resolution, posting,
encoding, and failure posture are in [the issue-log spec](../issue-log/SKILL.md). Counts
come from the summary. Compose the body, write it to a temp file with the Write tool, and
post:

```markdown
<!-- cc-forge-log v1: {"skill":"test-plan-walk","event":"test-plan-walk-complete","paths":["docs/tests/<file>.md"]} -->

### 🚶 /test-plan-walk — walk complete

**Summary:** <n> cases walked — <n> kept, <n> cut[, <n> not walked]
**Cut codes:** <code> ×<n>, <code> ×<n>
**Terms added:** <n> — <term, term, term>
```
```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

Omit `, <n> not walked` when every case is terminal, `**Cut codes:**` when nothing was
cut, and `**Terms added:**` when no term was captured. The stamp is a log entry, not the
analysis source; the doc is.

## Rules

- **Never read `docs/reviews/`.** The test and review families never read each other.
