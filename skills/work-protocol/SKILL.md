---
name: work-protocol
description: >
  Shared specification for the work document — the durable record /work and /grind write
  while they build, and that the test skills read one section of. Owns the rules every
  writer and reader obeys identically: the filename and frontmatter, the four sections and
  their formats, the D-card, the severity rubric and Status vocabulary, the scope-observer
  dispatch contract and its visibility wall, the observed-unit marker and resume, the
  reader's target match, the reply verbs, and the terminal one-liners. Not user-invocable;
  the callers cite it and restate none of it.
user-invocable: false
disable-model-invocation: true
---

# Work Protocol Specification (v1)

Two callers write one work document while they build; three callers read one section of
it.

| Caller | Does | With the doc |
|---|---|---|
| [`work`](../work/SKILL.md) | builds a plan unit by unit, confirm-gated | writes it, one per run; acts on deviations when the user replies |
| [`grind`](../grind/SKILL.md) | builds one phase slice by slice, unattended | writes it, one per run; leaves every deviation `open` |
| [`test-plan`](../test-plan/SKILL.md), [`test-plan-run`](../test-plan-run/SKILL.md), grind's test plan | produce and run the test plan | read `## Tests to Revisit` only, per [readers](#readers) |

This file is the single source of truth for every rule that applies to more than one of
them. Callers embed only their own prose — where in their loop each step fires, their own
brief and return contract wording, and their own terminal wording — and reference this
spec for everything below. **Never restate a rule from this file inside a caller**, not
even paraphrased.

Every rule here is written so both writers can execute it: `/work`'s orchestrator, which
dispatches one worker per unit and commits after each, and grind, where each slice's build
agent commits every unit itself. A rule only one of them could run does not belong here.

Throughout, **the orchestrator** means whichever writer is running — it holds `Bash`, runs
every command, and is the **sole writer of the doc**; **the observer** means
`forge:workflow:scope-observer`; **a card** means one `D<severity>-<n>` block.

## Scope and non-goals

- **Deviations never leave the doc.** They never enter a PR body, are never stamped on the
  issue, and add no event to [the issue-log registry](../issue-log/SKILL.md). The work doc
  is a local artifact; the stamps `/work` and `/grind` already post are unchanged.
- **The observer flags and never blocks.** It never gates a commit, reverts, edits, or
  re-dispatches. Acting on a card is a human reply in `/work` and nothing at all in
  `/grind`.
- **No "Unverified" section and no unchecked-line count.** A `Verification` line the
  observer cannot check statically is skipped silently — behavior is the test plan's
  domain, not this doc's.
- **No interactive deviation walk.** Cards are resolved by a one-line reply, never walked.
- **Reads go one way: test → work.** The test callers read this doc's `## Tests to
  Revisit`; a work doc never reads a test doc or a review doc.

## Prerequisites

- A git repository. `git rev-parse --show-toplevel` resolves the repo root; `docs/work/`
  is always `<repo root>/docs/work/`. Inside a `/tree` worktree that path is the symlinked
  `docs/`, so writes land in the primary checkout — which is correct and intended.
- `docs/work/` is gitignored, scratch under `docs/work/.raw/` included. Work docs are
  local working artifacts, never committed.

## The document

One file per run, `/work`'s or grind's, at:

```
docs/work/YYYY-MM-DD-NNN-<slug>-work.md
```

`<slug>` is the branch name sanitized exactly as `agents/test-plan/test-synthesizer.md`
sanitizes it, so `feat/foo` becomes `feat-foo`. `NNN` is the highest same-date sequence in
`docs/work/` plus 1, starting at `001`; a sequence segment that is not a zero-padded
integer is ignored. Readers discover docs by this convention — never change it.

### Frontmatter

```yaml
---
title: <one line naming the plan or run>
target: <branch name>
date: YYYY-MM-DD
plan: <repo-relative path of the plan, or of the spec or todo file when there is no plan>
base: <SHA HEAD pointed at when the run started>
status: in-progress   # in-progress | complete
---
```

- `target:` is the gate every reader checks. See [readers](#readers).
- `base:` makes every Changes number recomputable from git alone, so resume never trusts
  in-context state.
- `status:` becomes `complete` only after [the wrap-up pass](#wrap-up-mode) has been
  recorded.

### Lifecycle

- **Created once the run is approved to start** — `/work` at the end of its Phase 1, grind
  at run start, before its first slice — with frontmatter, empty sections, and
  `## Decisions` seeded from any resolved `Deferred to Implementation` questions. A blocked
  first unit or a kill still leaves a doc.
- **Updated after every unit's commit**: `## Changes` rewritten, `## Tests to Revisit`
  merged, `## Decisions` rewritten, new cards appended, and the unit's
  [observed marker](#the-observed-marker) written. The doc is written incrementally, never
  only at the end, so a compaction or a kill loses at most one unit's record — and resume
  rebuilds that from git.
- **Closed at wrap-up**: wrap-up cards written, then `status: complete`. Grind has one
  wrap-up, after its last slice.

### Sections

Exactly four, in this order, every heading always present:

1. `## Changes`
2. `## Tests to Revisit`
3. `## Decisions`
4. `## Deviations`

## Changes

The complete per-file table for the run, **never truncated in the doc** — a terminal copy
may truncate; the doc may not.

| File | +/- | Unit | Summary |
|---|---|---|---|
| `/absolute/path/to/repo/src/auth.ts` | +45 / -12 | 2 | Added token refresh to the middleware |

- **File** — the full absolute path, `git rev-parse --show-toplevel` joined to the
  repo-relative path, in backticks.
- **+/-** — from `git diff --numstat <base>..HEAD`.
- **Unit** — the ordinal of every unit that touched the file, comma-separated; `—` when
  there is no plan.
- **Summary** — one line, accumulated across units: the orchestrator carries a one-line
  summary per file from each worker's return and merges a later unit's line into the
  earlier one rather than appending a second.

**Rewritten wholesale on every update**, never patched: numbers from git, summaries from
the accumulated lines. A total line follows the table:
`N files changed, X insertions(+), Y deletions(-)`.

## Tests to Revisit

Existing tests the change may have made stale. Workers report them in their return
contract; the orchestrator records them. One entry per test:

```markdown
- `<absolute path>[::<test name>]` (Unit <ordinal>[, <ordinal>…]) — <one sentence on why>
```

- `::<test name>` names one test; without it the entry means the whole file.
- **De-duped by path.** A second report of the same `<path>[::<name>]` merges into the
  existing entry: its unit ordinal is added and its reason merged into the sentence, never
  a second entry.
- Entries are appended, never removed by a writer. Judging them — delete, regression, or still
  valid — belongs to the test pipeline under
  [`test-protocol`](../test-protocol/SKILL.md), not to this doc.
- No entries: `_None reported._` under the heading.

## Decisions

The run's digest: resolved `Deferred to Implementation` questions and the patterns and
constraints the run established. Bullets, **rewritten wholesale** from the orchestrator's
digest (in grind, every slice's returned decisions merged in slice order) on every update,
so the doc always holds the consolidated digest rather than a log of every revision of it.
None: `_None recorded._`

## Deviations

### The D-card

```markdown
### D<severity>-<n>: <title>
**Status:** `open`   <!-- open | kept | reverted | fixed -->
**Category:** <extra | missing | changed>
**Unit:** <ordinal>: <unit title>
**Files:**
- <absolute path>
**Deviation:** <one sentence>
**Reason:** <one sentence, or "none given">
```

- **One sentence per field.** `**Files:**` is always a hyphenated list, even for one file.
- **Neutralize before writing.** `**Deviation:**` and `**Reason:**` are agent prose beside
  the anchor every reader keys on: collapse each to one line and escape heading-shaped,
  code-fence, and bold-field-label fragments, as
  [the review synthesizer](../../agents/review/review-synthesizer.md) does.
- `### D<severity>-<n>:` with `**Status:**` on the line directly below is the anchor every
  reply edits against. A new per-card field goes below `**Status:**`, never between it and
  the heading.
- **Cards are ordered by severity** — every `D1` card, then `D2`, then `D3` — and by `n`
  within a severity.

### Severity

| Level | When |
|---|---|
| `D1` | Crossed a plan `Scope Boundary`, or skipped or reshaped what a unit asked for — including a `Verification` line that failed at wrap-up |
| `D2` | A behavior change, or a file change, outside the unit's listed `Files` |
| `D3` | An incidental extra file touch with no behavior change |

The levels deliberately parallel review's `P1`/`P2`/`P3` while staying visibly distinct
from review findings. The rubric is tuned here, never in a caller.

### Category

Every card carries exactly one, independent of severity — the way a review finding carries
a `Category:` beside its `P` tier. The three collapse the HAZOP guide words for a deviation
from design intent.

| Category | Means |
|---|---|
| `extra` | Did something the unit did not ask for — an unlisted file, an added behavior, a crossed `Scope Boundary` |
| `missing` | Skipped part of what the unit asked for — including a `Verification` line that failed at wrap-up |
| `changed` | Did the asked-for thing differently from the unit's `Approach` |

The category picks the [reply verbs](#reply-verbs).

### Numbering

`n` is a **per-severity sequence in discovery order**: the first `D2` found is `D2-1`, the
next `D2-2`, independent of how many `D1`s exist. A card's ID never changes once written —
no renumbering, no re-grading, no deletion; cards are cited by ID in replies. On resume,
each severity continues at its highest existing `n` + 1.

### `Status:` values

`open | kept | reverted | fixed`

- `open` — nobody has acted. The initial value for every card, and the only value grind
  ever writes.
- `kept` — the user accepted the deviation as built.
- `reverted` — the deviating hunks were removed by a dispatched revert.
- `fixed` — **`missing` and `changed` cards only**: a dispatched fix did what the unit
  asked for.

### `Reason:`

The observer never writes `Reason:` — it never sees the worker's account. The orchestrator
fills it after the observer returns: from the worker's reported deviation when the worker
reported one matching the card, otherwise the literal `none given`. `none given` is the
signal that a deviation went unreported; there is no separate source field.

A deviation the worker reported but the observer did not flag also becomes a card: the
orchestrator assigns its severity per [the rubric](#severity) and fills `Reason:` from the
report. Only what is in the committed diff counts — a reported deviation that the
orchestrator's own review sent back and a re-dispatch removed is not carded.

### Section states

- No cards and the observer ran: `_None — the observer flagged nothing._` under the
  heading.
- No plan units to observe (the input was a spec or todo file): `_No plan — observer not
  run._` under the heading, and no observer is dispatched for the run.
- An observer dispatch that failed: `_Unit <ordinal>: observer failed._` (or
  `_Wrap-up: observer failed._`) below the cards — distinguishable from a clean pass.

## The scope observer

`forge:workflow:scope-observer` holds `Read, Glob, Grep, Bash` and no `Write` or `Edit`,
so flagging is all it can do. It has two modes.

### `unit` mode

Audits one unit's diff against that unit's plan fields.

| Caller | When | The diff |
|---|---|---|
| `/work` | after the orchestrator's conformance review, **before** the unit's commit | the uncommitted working tree: `git diff HEAD` plus the untracked files `git status --porcelain` lists, which `git diff` never shows |
| grind | after each slice's build agent returns, once for each of its units | that unit's commit range, `git diff <base>..<head>`, from the build agent's return verified against `git log` |

**Inputs:** the absolute plan path, the unit ordinal, the diff or range, the
orchestrator's addenda list (empty when there are none), and optionally the working
directory — the absolute path of the tree to audit, defaulting to the current directory.

**Addenda are allowed extras.** A drive-by fix the orchestrator rode on the worker's brief
is in scope for that unit; the observer flags nothing it lists. Addenda are the
orchestrator's words, not the worker's return, so passing them does not breach the wall.

### `wrap-up` mode

Runs once, after the last unit, over every unit the run committed — units reported blocked
and units the plan marks `retired` are not checked. Grind's pass is bounded to the units of
the phase being built.

**Inputs:** the absolute plan path, the unit ordinals to check, and optionally the working
directory, as in [`unit` mode](#unit-mode). It checks each unit's `Verification`
lines against the tree **with read-only commands only** — `grep`, `ls`, `git`, and file
reads. A line that would need project code executed is behavioral and is **skipped
silently**. A miss becomes a `D1` card naming the failed line in `**Deviation:**`. A
passing line leaves no trace.

### What the observer sees

**May see:** the plan's fields for the unit or units under audit, the plan's
`Scope Boundaries`, the diff or range, and the addenda list.

**May not see:** the worker's return — its account of what it did and why. A persuasive
rationale would suppress the flag the card exists to raise.

**Where the wall is controlled and where it is only instructed** — stated plainly, because
an instructed wall is weaker than it looks:

- **Controlled, for the current `/work` unit's brief.** Only what the orchestrator puts in
  the brief is controlled: when the observer runs, that worker's return exists nowhere on disk and no commit message has been written from it. The next
  worker is never dispatched until the observer returns, so it never sees half-finished
  edits either.
- **Instruction-only, everywhere else.** Earlier units' `Reason:` lines and the digest sit
  in `docs/work/`, and grind's build agent wrote its own commit messages. The observer is
  told to read git only through `git diff` and `git show --format=` (no messages), never
  `git log` messages, and never to open `docs/work/`. It holds the tools to do otherwise.

### Returns

Cards in [the D-card shape](#the-d-card) **without** `**Reason:**` and without `n` — the
orchestrator assigns `n` per [numbering](#numbering) — or the explicit line
`no deviations`.

### Failure

**An observer failure never blocks.** The unit commits as it would have, the doc records
the failure per [section states](#section-states), and the run continues. The unit's
marker is written with `failed` so resume does not retry it.

## The observed marker

After a unit's doc update, the orchestrator writes one HTML comment directly under
`## Deviations`, one per line, above the cards:

```markdown
<!-- observed: <ordinal> -->
<!-- observed: <ordinal> failed -->
<!-- observed: wrap-up -->
```

**The doc update
— and so the marker — is written after the unit's commit**, so a marker's presence always
means the unit is committed and recorded. A kill between commit and doc write leaves a
committed unit with no marker, which resume repairs.

## Resume

- **Which doc.** An existing doc whose `target:` matches the current branch and whose
  `plan:` matches the plan being run is continued, never replaced; with several, the
  newest by the filename convention. `base:` is kept as written. A later grind phase runs
  on its own `-p<n>` branch, so it never matches the earlier phase's doc even though
  `plan:` is identical — that is intended, not a bug to fix.
- **Committed but unobserved units go first.** Each committed unit with no marker is
  observed in `unit` mode against its commit range, then recorded, before any new work.
- **Numbering continues** per severity at the highest existing `n` + 1.
- **Changes is recomputed** from `git diff --numstat <base>..HEAD` — never from memory.

## Reply verbs

`/work` only; grind leaves every card `open`. The user replies with a verb and a card ID
(`revert D2-1`, `keep D3-2`, `fix D1-1`).

| Category | Verbs | Result |
|---|---|---|
| `extra` | `revert`, `keep` | `revert` dispatches a worker to remove it → `reverted` |
| `missing`, `changed` | `fix`, `keep` | `fix` dispatches a worker to do what the unit asked → `fixed` |

- `keep` → `kept`, with no dispatch.
- **A revert brief names the hunks, never whole files.** A file can carry in-scope and
  out-of-scope changes together.
- **A fix or revert commit is never observed.** The user ordered it, so the observer
  could only flag the correction itself. The orchestrator commits it, rewrites
  `## Changes`, and moves the card's `Status:`.
- **Warn before dispatching** when a test doc (`docs/tests/*.md` with a matching
  `target:`) or an open PR already exists for the branch — both describe the tree the fix
  or revert is about to change.
- A verb that does not apply to the card is not acted on; the reply names the verbs that
  do.
- **Silence leaves `open`.** No reply is ever inferred.

## Readers

The test callers find the doc by auto-discovery: the newest `docs/work/*.md`, by
lexicographic sort over the filename convention, whose `target:` matches the current
branch.

- **A mismatch or no doc means no work doc is passed** — never a stop, never a warning
  that halts. The lens simply runs without one.
- **Only the blast-radius lens receives it, and only for `## Tests to Revisit`.** The spec
  lens never does. What the lens does with the entries is
  [`test-protocol`](../test-protocol/SKILL.md)'s.

## Terminal one-liners

- **`/work`** ends with the change table — which may truncate in the terminal — followed
  by exactly: `N deviations — see <doc path>.`, the absolute doc path in backticks, `N`
  the number of cards in the doc.
- **grind**'s terminal report and email carry the same line, exactly; its push
  notification carries the count only.

No other surface — PR body, stamp, PR comment — mentions deviations.

## Rules every work doc inherits

- **The orchestrator is the sole writer.** The observer returns cards; workers and build
  agents return reports; only the orchestrator writes the doc.
- **The observer flags, never blocks.** A failure records `observer failed` and the unit
  commits anyway.
- **The observer never sees the worker's return.** Controlled through the brief for the
  current `/work` unit; instruction-only for earlier `Reason:` lines, the digest, and grind's commit
  messages — and the spec says so rather than pretending otherwise.
- **Write after every unit's commit, never only at the end.** Changes, Decisions, Tests to
  Revisit, cards, and the marker, in one update.
- **Numbers come from git.** Changes is recomputed from `base:`, never carried in context.
- **Cards are never renumbered, re-graded, or deleted.** `n` is per severity, discovery
  order, and resumes at highest + 1.
- **`Reason:` is the orchestrator's**, from the worker's report or `none given`.
- **Deviations stay in the doc.** Never a PR body, never a stamp, never a new issue-log
  event.
- **Only a user reply moves a card off `open`**, and only in `/work`.
- **Readers match `target:` and read one section.** No match means no doc, never a stop;
  only the blast-radius lens reads it, and never the spec lens.
