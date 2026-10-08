---
name: test-plan-walk
description: >
  Walk through a test plan interactively, one T-NNN case at a time, before any test runs.
  Reads a docs/tests/*.md document produced by /test-plan or /grind, renders each case as
  a compact card (mode, source, viability, keep rule, what it asserts, why it was kept,
  the kind of test it is, and a recommendation computed when the walk reaches it), then
  takes keep / explain / cut / add term — or free text. Cut records one of nine coded
  reasons. `**Walk:**` and `**Recommended:**` lines are written inline under each case's
  `Status:` so progress is durable and resumable. Triggers on phrases like "walk the test
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
the case block, [the `**Walk:**` and `**Recommended:**` grammar](../test-protocol/SKILL.md#the-walk-and-recommended-lines),
[`Status: cut`](../test-protocol/SKILL.md#the-six-status-values), and the `walked:`
frontmatter key. Only what is specific to walking a test plan is written here.

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
   found for `<branch>` in `docs/tests/`. Run `/test-plan` first." When an **older** match
   carries `walked:`, warn in one line that its verdicts do not carry forward to this doc.
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

Every case terminal → write `walked:` (Step 7), report "Walk already complete. N cases —
n kept / n cut.", and exit.

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

The call is `keep` or `cut — <code>`, using [the cut codes](#the-cut-codes). **A case that
already carries `**Recommended:**` keeps it** — on resume it is reused, never recomputed.

### The claim

Before the card renders, write `**Walk:** pending` and `**Recommended:** <call>` in one
write, per [claim first](../walk-protocol/SKILL.md#claim-first) and
[the state-line write](#the-state-line-write). The recommendation is never revised after
this: not after `explain`, not when the user overrules it.

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

| Reply | Action |
|-------|--------|
| `1`, `keep`, `yes` | **Keep**. |
| `2`, `explain`, `why`, `more`, a question about the case | **Explain**. Self-loop. |
| `3`, `cut`, `drop`, `no`, optionally followed by a code and text | **Cut**. A code and text in the reply pre-answer the picker. |
| `4 <x>`, `term <x>`, `add term`, `what is <x>` | **Add term**. Self-loop. |
| anything else | The "just tell me" path: answer in as few sentences as it needs and re-show the action list. Self-loop. |

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

`duplicates case` runs two checks, both warnings, never edits to another case:

- **The named case must exist and must not be cut.** A note naming no `T-NNN`, this case,
  a `T-NNN` with no heading in the doc, or one whose `**Walk:**` is `cut` → say which in
  one line and re-show the picker.
- **Cutting a case an earlier cut named.** When another case's `**Walk:**` reads
  `cut — duplicates case —` and names this case, print one line — "T-004 was cut as a
  duplicate of this case; cutting it too leaves that behavior untested." — and append
  `(T-004 was cut as a duplicate of this case)` to this case's note. Exclude this case's
  own line from the scan.

Then write `**Status:** \`cut\`` and `**Walk:** cut — <code> — <note>` in one write. The
note is the user's words, verbatim, collapsed to one line. Next card.

### The cut codes

Codes 1–6 are [the Drop List reasons](../test-protocol/SKILL.md#drop), spelled byte for
byte: a cut with one means the synthesizer had the rule and missed it. Codes 7–9 are
walk-only: a cut with one means the synthesizer lacks a rule.

1. **`pins a constant`** — the drop reason of that name.
2. **`asserts a mock`** — the drop reason of that name.
3. **`duplicates existing`** — the drop reason of that name: an existing repo test already
   covers it.
4. **`UI test in fake DOM`** — the drop reason of that name: a UI behavior asserted through
   jsdom that a real browser should own.
5. **`tests untouched code`** — the drop reason of that name.
6. **`library already guarantees it`** — the drop reason of that name.
7. **`duplicates case`** — another case in this plan covers it; the note names the `T-NNN`.
8. **`implementation detail`** — asserts how, not what; a refactor breaks it.
9. **`not worth it`** — real risk, too small for the test's cost.

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

Every write follows [the write protocol](../walk-protocol/SKILL.md#write-protocol). In a
test doc the case body sits between the `### T-<NNN>:` heading and `**Status:**`, so an
`Edit` anchor holding both would carry the whole body through the write. Instead, the
anchor is the heading, and a scoped rewrite changes only the state lines under it:

1. Re-read the case block from disk, per
   [re-read before every write](../walk-protocol/SKILL.md#re-read-before-every-write).
2. Count the heading: `grep -c -F -- "### T-<NNN>:" <doc>` must print `1`, per
   [anchoring](../walk-protocol/SKILL.md#anchoring). `0` or more than `1` stops as that
   section says.
3. Write the three state lines to a temp file with the Write tool, in this order: the
   `**Status:**` line (copied from the fresh read, or `` **Status:** `cut` `` on a cut), the
   `**Walk:**` line, the `**Recommended:**` line (copied from the fresh read once it
   exists).
4. Run:

   ```bash
   awk -v id='### T-<NNN>:' -v state='<temp file>' '
   BEGIN { while ((getline l < state) > 0) s[++k] = l }
   index($0, id) == 1 { inb = 1; hits++; print; next }
   inb && /^##/ { inb = 0 }
   inb && /^\*\*Status:\*\*/ { n++; print s[1]; tail = 1; next }
   tail && /^\*\*Filter:\*\*/ { print; next }
   tail && /^\*\*(Walk|Recommended):\*\*/ { next }
   tail { print s[2]; print s[3]; tail = 0 }
   { print }
   END { if (tail) { print s[2]; print s[3] }; if (hits != 1 || n != 1) exit 3 }
   ' <doc> > <doc>.tmp && mv <doc>.tmp <doc> || { rm -f <doc>.tmp; echo "STOP: anchor"; }
   ```

   It replaces `**Status:**`, keeps any `**Filter:**` line in place, and writes `**Walk:**`
   and `**Recommended:**` beneath them — the order
   [the spec fixes](../test-protocol/SKILL.md#case-blocks). It refuses, leaving the doc
   untouched, unless the heading and the block's `**Status:**` line each occur exactly
   once. A refusal stops the walk, as an ambiguous anchor does.

The rewrite never touches any line outside the case's state lines.

## Step 7: Finishing

Per [the summary](../walk-protocol/SKILL.md#the-summary), re-read the doc and derive every
count from the `**Walk:**` lines:

- **Buckets** — kept, cut, never reached (no `**Walk:**` line), left pending. The
  declined bucket is always empty, because the walk has no skip verb; the summary says
  so.
- **Cut codes** — a count per code, one line, e.g. `duplicates existing ×3, not worth it ×1`.
- **Agreement** — how many walked cases' verdict matches their `**Recommended:**`. A cut
  agrees only when its code matches too.
- **Terms added**, as the spec defines it.

**Write `walked:` on every exit** — complete, already complete, or ended early — per
[the frontmatter rule](../test-protocol/SKILL.md#frontmatter): re-derived from the
`**Walk:**` lines, never from session memory. Edit the existing `walked:` line in place,
or insert it directly after the `lenses:` line, counting the anchor with `grep -c -F --`
first. The zero-case exit in Step 1 writes nothing.

Then stamp (§7a), and close with one line: `Next: /test-plan-run`.

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

- **Never touch a `V-NNN` block or the Drop List.** They are rendered nowhere and edited
  never.
- **Never read `docs/reviews/`.** The test and review families never read each other.
- **Never write a test file, and never run one.**
- **Never set a `Status:` other than `cut`**, and never edit a `**Filter:**` line.
- **Never revise `**Recommended:**`** once written.
- **Every case gets its own card and its own reply**, per
  [walk order](../walk-protocol/SKILL.md#walk-order). Explain and Add term never advance
  the walk.
