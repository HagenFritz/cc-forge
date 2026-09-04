---
name: review-sweep
description: >
  Take the quick wins from a code-review document unattended. Reads a review file
  produced by /deep-review, reads the cited code for each finding in doc order,
  implements only the cheap-and-certain fixes, marks reviewer misreads `wont-fix`,
  and leaves everything else `open` with a durable `Sweep:` reason line explaining
  why a human still has to look. Zero prompts — invoking it is the confirmation.
  Edits are inline and uncommitted; it never commits, pushes, or files issues.
  Triggers on phrases like "sweep the review", "review-sweep", "quick wins from the
  review", or passing a path to a docs/reviews/*.md file.
user-invocable: true
disable-model-invocation: true
argument-hint: "[path to docs/reviews/*.md]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Review Sweep — One-Shot Quick-Win Pass

**Note: The current year is 2026.**

`/review-sweep` consumes a review doc from `docs/reviews/` and takes exactly the findings
that are cheap and certain: it reads the cited code, applies the small fixes, closes out the
reviewer's misreads, and leaves every remaining finding `open` with a one-line reason a human
can act on. It is the unattended sibling of `/review-walk` — same doc, same `Status:`
vocabulary, no questions — and the conservative inverse of `/grind`'s accept-by-default
triage: here, **surfacing is the default and implementing is the exception.**

It produces no findings, re-reviews nothing, and never touches git history. Every edit lands
in the working tree, uncommitted, for the user to read.

Typical flow: `/deep-review` → `/review-sweep` → `/review-walk` over what the sweep surfaced.

## Core Principles

1. **Invocation is the confirmation.** No prompts, previews, or confirm gates. A run either
   completes with a report or stops before its first edit with a stop message.
2. **Every finding ends in exactly one state:** `done`, `wont-fix`, or `open` with a
   `**Sweep:**` reason. No finding may be left `in-progress` when the loop ends.
3. **Read the code before any verdict.** A reviewer working from a diff misjudges context the
   surrounding file makes obvious — the same rule `/grind`'s triage runs under (see
   [grind step 30](../grind/SKILL.md)). Only an affirmative "the code does not have this
   problem" becomes `wont-fix`; uncertainty surfaces.
4. **When in doubt, surface.** A missed quick win costs one line in the report. A wrong
   unattended edit costs the user's trust in the working tree.
5. **Never destroy user state.** Files already dirty before the run are never edited. Every
   revert is patch-based, never a bare `git checkout`.

## Step 1: Resolve the Doc

- If the user passed a path, use it. Verify it exists with `ls`.
- If no path was passed, auto-discover the newest review doc:

  ```bash
  ls docs/reviews/*.md 2>/dev/null | sort | tail -1
  ```

  The filename convention is `YYYY-MM-DD-NNN-<slug>-review.md`, so a lexicographic sort picks
  the most recent doc deterministically.

- No review docs exist → stop: "No review docs found in `docs/reviews/`. Run `/deep-review` first."
- The doc has no `**Confidence:**` fields → stop: "`<absolute path>` predates review enrichment
  and carries no `Confidence:` fields. The sweep needs them to decide what is safe to fix
  unattended. Walk it with `/review-walk` instead." Confidence is load-bearing for every branch
  of the triage rule; there is no defensible default for a missing value.

**Print the resolved absolute path as the first line of output**, before anything else:

```
Sweeping review: /abs/path/to/docs/reviews/<file>.md
```

Then read the doc in full.

## Step 2: Preflight

Everything here runs **before the first edit**. Every failure below is a stop, not a warning —
a skill that edits code unattended has no safe way to proceed on a broken premise.

1. **Git.** `git rev-parse --show-toplevel` and `git rev-parse --abbrev-ref HEAD`. Scope every
   later command to the repo root. Not a git repo → stop: "Not a git repository. The sweep needs
   git to bound and revert its own edits." Detached HEAD (`HEAD` as the branch name) or a failing
   `git status` → stop with the same posture: "Detached HEAD. Check out a branch first."

2. **`target:` check.** Read `target:` from the doc's frontmatter. Its value is a branch name, a
   `PR #N` reference, or a `PR #N | branch-name` pair.
   - **Match** — the current branch equals the branch side, or `PR #N` resolves via
     `gh pr view <N> --json headRefName` to the current branch. Either side of a `|` pair
     matching is a match. Proceed.
   - **Parseable and different** → stop before any edit: "`<doc>` targets `<target>`; you are on
     `<branch>`. Check out the reviewed branch first." The doc's findings cite line numbers in
     code that is not checked out; editing here would be edits at random.
   - **Absent, empty, or unparseable** → warn in the report ("`target:` unreadable — proceeded on
     `<branch>`") and continue. A malformed frontmatter field is not worth refusing to run over.

3. **Dirty baseline.** `git status --porcelain` once, at this moment, capturing modified, staged,
   and untracked paths. This is the **dirty baseline**: it is never re-read, and it is what makes
   every later scope check and revert exact. Any finding citing a path in this set is surfaced
   with `dirty file: <path>` — the user's in-flight work is never touched, and the sweep never has
   to disentangle its edits from theirs.

   `docs/reviews/` is gitignored in this repo, so the sweep's own `Status:` writes never appear in
   `git status`. The doc needs no exclusion from the baseline or from any later scope check.

4. **Interrupted run.** Any finding at `Status: in-progress` is the residue of a killed run. Flip
   it to `open` and add `**Sweep:** interrupted`. Never auto-resume it and never auto-revert its
   edits — a half-applied fix in the working tree is indistinguishable from the user's own work.
   Report these at the top of the run.

   `/grind` also writes `in-progress` to mean "accepted, fix pending". The `target:` check in step
   2 is the guard: a grind doc targets a PR on its own branch, so a sweep run from elsewhere stops
   before it can misread those lines.

5. **Cascade membership.** Read `## Groups`. Record, per finding, the group it belongs to and that
   group's `Cascade:` text. A member of a group whose `Cascade:` is anything other than
   independent (the synthesizer's phrasing is `independent fixes — no ordering dependency.`) is
   surfaced with `cascade`. The reviewer said fix order matters; the sweep does not reorder and
   does not fix out of order.

6. **Empty doc.** No `### P` issue headings at all → the run is a no-op. Report one line — "No
   findings in `<absolute path>` — nothing to sweep." — and stop. This is a successful terminal
   state, not an error.

## Step 3: The Triage Loop

Walk the findings **in doc order** — the order they appear under `## Issues`, P1 through P3.
Doc order is what guarantees a P1 is adjudicated before any later finding that shares its files.

For each finding, evaluate the conditions below **in this exact order, first match wins.** A
finding matching several conditions is reported under the first one that matched; the order is
cheapest-and-most-decisive first, so nothing reads code it did not have to.

| # | Condition | Outcome |
|---|-----------|---------|
| 1 | `Status:` is `done`, `deferred`, or `wont-fix` | Skip. Count as a **prior decision**, not this run's. |
| 2 | `Status:` is `open` and it already carries a `**Sweep:**` line | Skip as **already swept**. Counted separately; no second `Sweep:` line is ever written. |
| 3 | The fix would delete or gitignore a protected artifact | `wont-fix` + `**Skip reason:** protected artifact — <path>` (see step 4). |
| 4 | `Confidence:` is `low` | Surface: `low confidence`. **Do not read the code.** |
| 5 | Any cited path is in the dirty baseline | Surface: `dirty file: <path>`. Nothing is edited. |
| 6 | Any cited path cannot be resolved, or resolves to a directory | Surface: `stale citation`. |
| 7 | Any cited path is contested by a surfaced P1 | Surface: `overlaps surfaced P1-<N>`. |
| 8 | The finding belongs to a group whose `Cascade:` is not independent | Surface: `cascade`. |

Only a finding that matches none of the eight reaches the code.

### 3a. Extracting the cited paths

`**File(s):**` is free prose. Take every backtick-delimited span in it as a candidate path and
resolve each against the repo root:

- Resolves to an existing **file** → a cited path.
- Resolves to nothing, or to a **directory** → the citation is unusable: surface with
  `stale citation` (condition 6). Do not guess at a nearby file.
- A span that is plainly not a path — a symbol name, a function, a code fragment like
  `sanitize()` — resolves to nothing and would trip condition 6 on its own. Only apply condition
  6 when **no** span in the field resolves to a file; when at least one does, those files are the
  citation and the non-path spans are prose.

Line numbers in the field are **hints only**. Earlier fixes in this run shift them.

### 3b. Contested files

When a **P1** is surfaced for any reason, its cited paths become **contested** for the rest of the
run, and every later finding citing one of them surfaces with `overlaps surfaced P1-<N>`. The
sweep does not edit a file whose most serious known problem is still unadjudicated.

This applies to P1 only. In a small repo where one file holds everything, a surfaced P2 or P3
must not block every remaining Small fix in that file.

### 3c. Read the code

Read the cited file(s) now, immediately before deciding anything — not from an earlier read.
Anchor on the code the finding describes, not on the line number.

| What the code shows | Outcome |
|---------------------|---------|
| The problem is really there | Continue to 3d. |
| The code affirmatively does **not** have this problem — the reviewer misread it | `wont-fix` + `**Skip reason:** reviewer misread — <one line on what the code actually does>`. |
| The described code cannot be found at or near the citation | Surface: `stale citation`. |

The middle and bottom rows are different verdicts and must not be collapsed. "I read it and the
concern does not apply" closes a finding. "I could not find what it is talking about" does not —
that is a human's call.

### 3d. The implement rule

Two rows. Everything else surfaces.

| Effort | Tier | Confidence | Implement? |
|--------|------|-----------|------------|
| Small | any | `high` or `medium` | Yes |
| Medium | P1 only | `high` | Yes |

Anything else — Large at any tier, Medium below P1, Medium at P1 without high confidence — is
surfaced with `outside the sweep rule`. This is not a judgment that the finding is wrong: the code
was read and the problem confirmed. It is a judgment that the fix is too big to land unattended.

### 3e. Preconditions, checked before `in-progress`

All three are gates on a finding that passed 3d. A failure here surfaces the finding; nothing has
been edited yet.

- **Concrete `Fix:` (R4).** The `Fix:` text must name the change — the function, the call site, the
  condition, the expected behavior after. Text that only restates the problem ("handle this
  correctly", "add validation", "consider refactoring") is not actionable unattended: surface with
  `vague fix`.

- **Testing findings (R5).** A finding whose `Category:` is `testing`, or whose fix is to add test
  code, is implemented **only** when all of these hold — otherwise surface with `test precondition`:
  - `Confidence:` is `high`;
  - the test lands in a test file or fixture that **already exists** (the sweep creates no files —
    see step 4);
  - the test is one of three shapes: a **regression test for a bug this run fixed**; a test of
    **behavior at a public boundary**; or a test of a **caller-visible outcome branch**.

  Anything else — a test of a private helper, a restatement of the implementation, a coverage
  filler — surfaces. Tests that assert how code is written rather than what it does are the ones
  that break on every refactor and teach the suite to be ignored.

- **No unprompted tests (R6).** A code fix carries a test **only when its own `Fix:` text names
  one.** The sweep never adds a test on its own initiative alongside a fix. When a `Fix:` does name
  a test, that test is still subject to the R5 preconditions above.

### 3f. Implement

In this order, no step skipped:

1. **Set `Status: in-progress`** in the doc, per the anchoring rule in step 4. This happens
   **before a single line of code is edited**, so a killed run leaves a legible state.
2. **Capture the per-finding patch.** `git diff -- <this finding's cited paths>` to a file in the
   scratchpad. This patch contains any earlier finding's fixes in the same files — which is exactly
   what makes a revert here safe for them.
3. **Edit the code**, and only the code the `Fix:` describes. Do not extend the fix, do not tidy
   nearby code, do not rename anything the finding did not name.
4. **Scope self-check (R4).** `git status --porcelain` again, compared against the dirty baseline
   plus this finding's cited paths (plus the test file when R5/R6 applied). **Any extra path is a
   tripwire** — including a new untracked file, since the sweep creates none. A tripwire means the
   fix reached past its citation and the finding was not the small, bounded thing it looked like.
5. **On a tripwire: revert, then surface.** Restore the finding's cited paths
   (`git checkout -- <paths>`), re-apply the saved patch (`git apply <patch>`), and delete any
   untracked file the edit created. Set the finding `open` + `**Sweep:** uncited file`. Because the
   patch carried the earlier findings' fixes, they survive intact.
6. **Otherwise, set `Status: done`.**

## Step 4: Status Update Protocol

The review doc is the durable record. Every outcome above is written into it with `Edit` before
the loop moves on.

### Anchoring rule

Anchor each edit on **three things together**: the `### P<X>-<N>:` heading line, the blank line
below it, and the `**Status:** \`<value>\`` prefix. This is unique even when many findings share a
status value.

Fresh docs from the synthesizer emit a trailing HTML comment on the Status line:

```
### P1-1: Terminal escape injection via unsanitized name

**Status:** `open` <!-- open | in-progress | done | deferred | wont-fix -->
```

**Read the real line and carry everything after the status value through unchanged.** Do not
assume the comment is present and do not assume it is absent; match the prefix, preserve the tail:

```
### P1-1: Terminal escape injection via unsanitized name

**Status:** `in-progress` <!-- open | in-progress | done | deferred | wont-fix -->
```

Re-read the doc before each edit — it is the source of truth, and the user may have edited it
between turns.

### The `Sweep:` line

A surfaced finding keeps `Status: open` and gains one new line **directly under the Status line**:

```
**Status:** `open` <!-- open | in-progress | done | deferred | wont-fix -->
**Sweep:** <reason>
```

It always sits directly under `Status:`; any other reason line follows it. Exactly one `Sweep:`
line per finding, ever — a re-run skips a finding that already has one rather than appending a
second.

The reason comes from this fixed vocabulary. The reason is the instruction: it tells the human what
they are being asked to do.

| Reason | What it means | What the human does |
|--------|---------------|---------------------|
| `low confidence` | The reviewer flagged low confidence; the sweep did not read the code. | Read it and decide — it may well be noise. |
| `outside the sweep rule` | Real, confirmed in the code, too large to land unattended. | Fix it deliberately; it is a genuine finding. |
| `vague fix` | The problem is real; the `Fix:` text does not say what to change. | Decide the fix yourself, then apply it. |
| `uncited file` | The fix could not be made without touching a file the finding never cited; the edit was reverted. | Look at what the fix really requires — the scope is bigger than the finding claims. |
| `dirty file: <path>` | A cited file already had uncommitted changes before the run. | Commit or stash your work, then re-run the sweep or fix it by hand. |
| `stale citation` | The cited path or the described code could not be found. | Re-check against the current code; the review may have drifted. |
| `overlaps surfaced P1-<N>` | A cited file also holds a P1 that was surfaced, not fixed. | Settle P1-`<N>` first; then this one is likely trivial. |
| `cascade` | Its group's `Cascade:` says fix order matters. | Fix the group in `Suggested order:` — `/review-walk` does this well. |
| `test precondition` | A testing finding failed the R5 shape check or names a test file that does not exist. | Write the test yourself, or decide it is not worth writing. |
| `interrupted` | A previous sweep run died mid-fix on this finding. | Check the working tree for a half-applied edit before doing anything else. |

### `wont-fix` and `Skip reason:`

`wont-fix` closes a finding out. It takes a `**Skip reason:**` line, in the same position a
`Sweep:` line would occupy, and there are exactly two things it can say:

```
**Status:** `wont-fix` <!-- open | in-progress | done | deferred | wont-fix -->
**Skip reason:** reviewer misread — sanitize() is already applied at dash.js:317 on this path.
```

```
**Status:** `wont-fix` <!-- open | in-progress | done | deferred | wont-fix -->
**Skip reason:** protected artifact — the fix would gitignore docs/plans/.
```

- **`reviewer misread`** — the code was read and affirmatively does not have the problem. Name what
  the code actually does, in one line, so the user can check the call.
- **`protected artifact`** — the fix would delete or gitignore files under `docs/brainstorms/`,
  `docs/plans/`, or `docs/solutions/`. This is `/review-walk`'s
  [Protected Artifacts rule](../review-walk/SKILL.md); a finding proposing it is automatically
  `wont-fix` and is called out in the report, whatever its tier, effort, or confidence.

Nothing else earns a `wont-fix` from the sweep. Everything the sweep is merely unsure about stays
`open` with a `Sweep:` line.

### Files

The sweep **creates no files** — not a test file, not a fixture, not a helper module. Every edit is
to a file that already exists and that the finding cited. The scope self-check treats a new
untracked file as a tripwire precisely so this cannot happen by accident.

Edits are left **uncommitted**. The sweep never runs `git add`, `git commit`, `git push`, or
`git stash`, and never files an issue. Its only writes are to the reviewed source files, to the
review doc, and — at the end of the run — one stamp on the linked issue per
[the issue-log spec](../issue-log/SKILL.md).

<!-- Unit 2 continues: suite, report, stamp, rules -->
