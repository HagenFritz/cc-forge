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

It produces no findings, re-reviews nothing, runs no tests, and never touches git history. Every
edit lands in the working tree, uncommitted, for the user to read — verifying them is the user's
next step, not the sweep's.

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

- No review docs exist → stop: "No review docs found in `docs/reviews/`. Run `/deep-review` or `/quick-review` first."
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
   Report these at the top of the run, and count them as **surfaced this run** — the `Sweep:` line
   is this run's, so loop condition 2 exempts them rather than counting them already swept.

   `/grind` also writes `in-progress` to mean "accepted, fix pending". The `target:` check in step
   2 is the guard: a grind doc targets a PR on its own branch, so a sweep run from elsewhere stops
   before it can misread those lines.

5. **Unsigned terminal findings.** Any finding at `Status: done` carrying neither a `**Sweep:**`
   nor an `**Applied:**` line is unattributable — the signature convention reads it as the user's,
   and no later run can tell whether a fix actually landed. Never edit it and never re-open it:
   triage condition 1 skips it as a prior decision, which is correct. Report it at the top of the
   run as an anomaly with its id, so the user can check the working tree against the doc.

6. **Cascade membership.** Read `## Groups`. Record, per finding, the group it belongs to and that
   group's `Cascade:` text. A member of a group whose `Cascade:` is anything other than
   independent (the synthesizer's phrasing is `independent fixes — no ordering dependency.`) is
   surfaced with `cascade`. The reviewer said fix order matters; the sweep does not reorder and
   does not fix out of order.

7. **Empty doc.** No `### P` issue headings at all → the run is a no-op. Report one line — "No
   findings in `<absolute path>` — nothing to sweep." — and stop. No stamp is posted: a stamp for a
   doc with zero findings is noise. This is a successful terminal state, not an error.

## Step 3: The Triage Loop

Walk the findings **in doc order** — the order they appear under `## Issues`, P1 through P3.
Doc order is what guarantees a P1 is adjudicated before any later finding that shares its files.

For each finding, evaluate the conditions below **in this exact order, first match wins.** A
finding matching several conditions is reported under the first one that matched; the order is
cheapest-and-most-decisive first, so nothing reads code it did not have to.

| # | Condition | Outcome |
|---|-----------|---------|
| 1 | `Status:` is `done`, `deferred`, or `wont-fix` | Skip. Count as a **prior decision**, not this run's. |
| 2 | `Status:` is `open` and it already carries a `**Sweep:**` line **that this run's preflight did not write** | Skip as **already swept**. Counted separately; no second `Sweep:` line is ever written. |
| 3 | The fix would delete or gitignore a protected artifact | `wont-fix` + `**Skip reason:** protected-artifact — <path>` (see step 4). |
| 4 | `Confidence rationale:` is `not stated by reviewer`, or `Confidence:` is absent | Surface: `unrated confidence`. **Do not read the code.** |
| 5 | `Confidence:` is `low` | Surface: `low confidence`. **Do not read the code.** |
| 6 | Any cited path is in the dirty baseline | Surface: `dirty file: <path>`. Nothing is edited. |
| 7 | Any cited path cannot be resolved, or resolves to a directory | Surface: `stale citation`. |
| 8 | Any cited path is a **sensitive path** (see 3a) | Surface: `sensitive path: <path>`. **Do not read the code.** |
| 9 | Any cited path is contested by a surfaced P1 | Surface: `overlaps surfaced P1-<N>`. |
| 10 | The finding belongs to a group whose `Cascade:` is not independent | Surface: `cascade`. |

Condition 4 exists because a missing `Confidence:` is not the same as a low one.
[The synthesizer](../../agents/review/review-synthesizer.md) fills an unstated confidence with
`medium` and records `not stated by reviewer` as the rationale — so without this condition, a
finding **no reviewer rated** would be indistinguishable from a verified pattern match and, at
Small effort on P1 or P2, would be edited unattended. The rationale string is the only signal that
distinguishes them, so the sweep reads it.

Only a finding that matches none of the conditions above reaches the code.

### 3a. Extracting the cited paths

`**File(s):**` is free prose. Take every backtick-delimited span in it as a candidate path and
resolve each against the repo root:

- Resolves to an existing **file** → a cited path.
- Resolves to nothing, or to a **directory** → the citation is unusable: surface with
  `stale citation` (condition 7). Do not guess at a nearby file.
- A span that is plainly not a path — a symbol name, a function, a code fragment like
  `sanitize()` — resolves to nothing and would trip condition 7 on its own. Only apply condition
  7 when **no** span in the field resolves to a file; when at least one does, those files are the
  citation and the non-path spans are prose. **A span that does not resolve but is path-shaped —
  it contains a `/` or ends in an extension — is not prose**: it names a file the sweep cannot
  find, so the finding surfaces as `stale citation` even when a sibling span resolved. Otherwise a
  citation like ``File(s): `src/models.py` and db/migrate/003_x.rb`` silently drops the second
  path and the sweep edits believing its scope is confined.

Resolve every cited path to its **real** path (following symlinks) as well as keeping the cited
one. Both forms are checked against condition 8 — a link named `config/prod.conf` pointing at a
workflow file is sensitive on the strength of its target, not its name.

Line numbers in the field are **hints only**. Earlier fixes in this run shift them.

**This file is where the sensitive-path rule is defined**, unlike condition 3's protected-artifact
rule, which lives in [`/review-walk`](../review-walk/SKILL.md) and is cited from here. It is
**sweep-only**: `/grind` also edits unattended, through its own fix-agent dispatch, and honors no
equivalent check — a known gap, stated here rather than left implicit, and a candidate for a
follow-up that gives grind the same guard.

A cited path is **sensitive** (condition 8) when any of these hold, matched against the
repo-relative path, case-insensitively:

- **Schema and migrations** — a segment is `alembic`, `migrate`, or `schema`; any segment contains
  `migration`; a segment is `versions` under a `db` or `alembic` ancestor; or the extension is
  `.sql`.
- **CI and build** — the path is under `.github/workflows/`, `.circleci/`, or `.buildkite/`; or the
  basename is `Jenkinsfile`, `Dockerfile`, `.gitlab-ci.yml`, or starts with `docker-compose`.
- **Infrastructure and config** — the extension is `.tf`, `.tfvars`, `.tfstate`, `.hcl`, `.yaml`,
  or `.yml`.

These are the files where a wrong unattended edit does the most damage — a migration runs against
production on the next push, a workflow or config change alters what CI and deploys do. The sweep
never edits them; the finding surfaces unread, the same posture as low confidence.

**This is a name heuristic and claims no completeness.** It matches how these files are usually
laid out, not what they are: a migration directory the project configured somewhere else walks
through it, and an ordinary source file that happens to be named `MigrationWizard.tsx` is caught by
it. Both directions are expected. A missed file is the ordinary risk any surfaced-by-default rule
carries; a false positive costs one quick win and a line in the report. Widen the list when a real
layout slips through rather than treating a miss as a rule failure.

*(Basis: across 1,278 findings in the `ai-agents` and cc-forge review corpora as of 2026-09,
findings citing migration, CI-workflow, and infra-config paths were resolved `wont-fix` at roughly
30% against a ~10% baseline for ordinary source. Nearly all of that signal is `ai-agents`; cc-forge
is prose-only and contributes almost none of it.)*

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
| The code affirmatively does **not** have this problem — the reviewer misread it | `wont-fix` + `**Skip reason:** misread — <one line on what the code actually does>`. |
| The described code cannot be found at or near the citation | Surface: `stale citation`. |

The middle and bottom rows are different verdicts and must not be collapsed. "I read it and the
concern does not apply" closes a finding. "I could not find what it is talking about" does not —
that is a human's call.

### 3d. The implement rule

The rows below implement. Everything else surfaces.

| Effort | Tier | Confidence | Category | Implement? |
|--------|------|-----------|----------|------------|
| Small | any | `high` | any | Yes |
| Small | P1 or P2 | `medium` | any | Yes |
| Medium | P1 or P2 | `high` | not `testing`, not `architecture` | Yes |

A Medium-effort P1/P2 finding at high confidence whose `Category:` is `testing` or `architecture`
is surfaced with `excluded category: <category>`. It stays `open` — not `wont-fix`, not
`deferred` — so `/review-walk` presents it for a deliberate decision. Those two categories are
where a Medium fix means authoring test infrastructure or changing deploy and workflow structure —
in the same 1,278-finding corpus cited above, those two categories were declined far more often
than any other kind of finding, and again the signal is almost entirely `ai-agents`. The sweep
never lands either unattended.

A **Small** finding at P3 whose confidence is `medium` is surfaced with `unverified at P3`. It was
excluded on confidence, not on size — the sweep lands `medium` only at P1 or P2 — so it never
carries a reason claiming the fix is too big. This is the largest group the rule surfaces, so its
reason has to say what is actually true of it.

Anything else — Large at any tier, Medium at P3, Medium at P1/P2 without high confidence — is
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

The **touched set** is the run's own footprint: the union of the cited paths of every finding that
has reached `done` this run, plus any test file an R5/R6 test landed in. It starts empty, and a
finding's paths join it at the moment that finding is set `done` — never earlier, so a reverted
finding contributes nothing. It is the sweep's edits and only the sweep's edits, which is what makes the scope self-check in
3f.4 exact and the run report's file list honest.

In this order, no step skipped:

1. **Set `Status: in-progress`** in the doc, per the anchoring rule in step 4. This happens
   **before a single line of code is edited**, so a killed run leaves a legible state.
2. **Capture the per-finding patch.** `git diff -- <this finding's cited paths>` to a file in the
   scratchpad. This patch contains any earlier finding's fixes in the same files — which is exactly
   what makes a revert here safe for them.
3. **Edit the code**, and only the code the `Fix:` describes. Do not extend the fix, do not tidy
   nearby code, do not rename anything the finding did not name.
4. **Scope self-check (R4).** `git status --porcelain` again, compared against the dirty baseline
   ∪ the touched set ∪ this finding's cited paths (plus the test file when R5/R6 applied). The
   touched set is what keeps this exact once a second finding is implemented: files an earlier
   `done` finding edited are in neither the baseline nor this finding's citation, and without it
   they would read as extras and trip a false revert. **Any path outside that union is a
   tripwire** — including a new untracked file, since the sweep creates none. A tripwire means the
   fix reached past its citation and the finding was not the small, bounded thing it looked like.
5. **On a tripwire: revert, then surface.** Restore the finding's cited paths
   (`git checkout -- <paths>`), re-apply the saved patch (`git apply <patch>`), and delete any
   untracked file the edit created. Then restore the tracked paths the self-check flagged as
   outside the union (`git checkout -- <those paths>`) — safe without a patch, since a path outside
   the union is by definition not in the dirty baseline and so was clean before the run. Set the
   finding `open` + `**Sweep:** uncited file`. Because the patch carried the earlier findings'
   fixes, they survive intact. Leaving a stray tracked edit behind would false-trip every later
   finding's scope self-check and would be reported as the sweep's own edit in the run report.
6. **Otherwise, set `Status: done`** and append the sweep's signature directly under it:

   ```
     **Status:** `done`
     **Sweep:** implemented — <one line: what changed, in what-changed terms>
   ```

   The what-changed text is one line with structural markup neutralized, per
   [`/review-walk`'s reason-line rule](../review-walk/SKILL.md) — it sits beside the same anchors
   every parser keys on, and this line is model prose rather than the user's. **It is never
   empty**: a one-token diff still gets a clause (`implemented — removed the fallback branch`),
   never a bare `implemented` and never a dangling dash.

   **Write both lines in a single `Edit` call, never two.** A run killed between a `done` status
   and its signature would leave a fix that triage condition 1 skips forever and that no later
   reader can attribute — one atomic write is what makes that state unreachable.

   Every finding the sweep lands carries this line. It is how a later reader — or a later
   analysis of the doc — tells a sweep fix from a `/review-walk` fix: the walk never writes
   `Sweep:`, and the sweep never writes `Applied:`.

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

The `Sweep:` line is the sweep's signature: every finding the sweep decided — surfaced or landed —
carries exactly one, **directly under the Status line**, and nothing else ever writes one. A
surfaced finding keeps `Status: open` and gains a reason; a landed finding is `done` and gains
`implemented`:

```
**Status:** `open` <!-- open | in-progress | done | deferred | wont-fix -->
**Sweep:** <reason>
```

```
**Status:** `done` <!-- open | in-progress | done | deferred | wont-fix -->
**Sweep:** implemented — <one line: what changed>
```

It always sits directly under `Status:`; any other reason line follows it. Exactly one `Sweep:`
line per finding, ever — a re-run skips a finding that already has one rather than appending a
second.

The reason comes from this fixed vocabulary. The reason is the instruction: it tells the human what
they are being asked to do. Every reason belongs to a finding left `open` except the three terminal
signatures — `implemented` on a landed fix and the two `wont-fix` values — which record what the
sweep did rather than asking the human to adjudicate anything.

**The line's grammar is `**Sweep:** <token>[: <value>][ — <free text>]`** — always one line. The
token comes from the table below and is the only part a reader may key on. `<value>` is the bounded
argument some tokens take (a path, a finding id). `<free text>` is prose, and an em dash is what
separates it from the token, so **an em dash inside the free text becomes a comma** — otherwise the
line has two plausible splits and neither reader nor script can tell which is right.

| Reason | What it means | What the human does |
|--------|---------------|---------------------|
| `unrated confidence` | No reviewer stated a confidence; the synthesizer's `medium` default is not a reviewer's judgment. The sweep did not read the code. | Read it and decide — nobody has vouched for it yet. |
| `low confidence` | The reviewer flagged low confidence; the sweep did not read the code. | Read it and decide — it may well be noise. |
| `outside the sweep rule` | Real, confirmed in the code, too large to land unattended. | Fix it deliberately; it is a genuine finding. |
| `unverified at P3` | Real, confirmed in the code, and **small** — but the reviewer's confidence was `medium` and the sweep lands `medium` only at P1 or P2. Nothing about it is large. | Glance at it and apply it if you agree; these are usually seconds of work. |
| `excluded category: <testing\|architecture>` | Real, confirmed in the code, Medium effort at P1/P2 with high confidence — but a test-infrastructure or structural change the sweep never lands unattended. | Decide it in the walk: implement, defer, or won't-fix. The sweep took no position. |
| `vague fix` | The problem is real; the `Fix:` text does not say what to change. | Decide the fix yourself, then apply it. |
| `uncited file` | The fix could not be made without touching a file the finding never cited; the edit was reverted. | Look at what the fix really requires — the scope is bigger than the finding claims. |
| `dirty file: <path>` | A cited file already had uncommitted changes before the run. | Commit or stash your work, then re-run the sweep or fix it by hand. |
| `stale citation` | The cited path or the described code could not be found. | Re-check against the current code; the review may have drifted. |
| `sensitive path: <path>` | A cited path is a migration, a CI workflow, or a `.yaml`/`.yml`/`.tf` file; the sweep did not read the code. | Read it and decide — an unattended edit here has too large a blast radius. |
| `overlaps surfaced P1-<N>` | A cited file also holds a P1 that was surfaced, not fixed. | Settle P1-`<N>` first; then this one is likely trivial. |
| `cascade` | Its group's `Cascade:` says fix order matters. | Fix the group in `Suggested order:` — `/review-walk` does this well. |
| `test precondition` | A testing finding failed the R5 shape check or names a test file that does not exist. | Write the test yourself, or decide it is not worth writing. |
| `interrupted` | A previous sweep run died mid-fix on this finding. | Check the working tree for a half-applied edit before doing anything else. |
| `implemented — <what changed>` | The fix landed (`done`); the sweep made this edit. The free text is required here, however small the change. | Read the diff. It is uncommitted and in the working tree. |
| `wont-fix — misread` | The sweep read the code and closed the finding out (`wont-fix`); the `Skip reason:` line below says what the code actually does. | Check the call if you doubt it; otherwise nothing. |
| `wont-fix — protected-artifact` | The sweep closed the finding out (`wont-fix`) because its fix would delete or gitignore a protected path. | Nothing — the rule is absolute. |

### `wont-fix` and `Skip reason:`

`wont-fix` closes a finding out. It is a decision the sweep made, so it carries the sweep's
`**Sweep:**` signature directly under `Status:` like every other decided finding, with a
`**Skip reason:**` line following it. There are exactly two things that pair can say:

```
**Status:** `wont-fix` <!-- open | in-progress | done | deferred | wont-fix -->
**Sweep:** wont-fix — misread
**Skip reason:** misread — sanitize() is already applied at dash.js:317 on this path.
```

```
**Status:** `wont-fix` <!-- open | in-progress | done | deferred | wont-fix -->
**Sweep:** wont-fix — protected-artifact
**Skip reason:** protected-artifact — the fix would gitignore docs/plans/.
```

**`Skip reason:` carries one vocabulary across every writer.** Its codes are
[`/review-walk`'s](../review-walk/SKILL.md) — the sweep uses two of them and writes no others; the
walk and `/grind` use the full list. One field, one code set, whoever wrote it, which is what makes
counting them across a pile of review docs meaningful. Tell the writer apart by the adjacent
`**Sweep:**` or `**Grind:**` signature, never by the code.

- **`misread`** — the code was read and affirmatively does not have the problem. Name what
  the code actually does, in one line, so the user can check the call.
- **`protected-artifact`** — the fix would delete or gitignore files under `docs/brainstorms/`,
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

## Step 5: The Report

Printed to the terminal at the end of every run, in this order. Omit a section only when it has no
members.

1. **Doc path** — already the first line of output, from step 1. Not repeated.

2. **Preflight facts.** Current branch; whether `target:` matched, and how (branch, `PR #N`, or the
   unreadable-and-proceeded warning); the dirty-baseline count and which findings it surfaced;
   any finding flipped from `in-progress` to `interrupted`.

3. **Implemented** (`done`). Per finding: id and title; the files **actually touched**, read from
   `git status --porcelain` and the diff rather than from `File(s):`; the test added and the file it
   landed in, when R5/R6 applied; and one plain sentence of what changed. Write that sentence in
   what-changed terms drawn from the `Fix:` intent and the real diff hunk — not a paste of the
   reviewer's problem statement.

4. **`wont-fix`.** Per finding: id, title, and the reason, labelled as **misread** or
   **protected-artifact**. The two are different claims and the report keeps them apart.

5. **Surfaced** (`open` + `Sweep:`). Per finding: id, title, the `**Plain English:**` field
   **verbatim** from the doc, and the `Sweep:` reason. This is the section the user actually reads to
   decide what to do next, and the reviewer's own plain-English line is better at that than any
   summary of it.

6. **Prior and already-swept counts.** Two numbers with one line each: findings that arrived with a
   terminal status (prior decisions, not this run's) and findings already carrying a `Sweep:` line
   from an earlier run.

7. **Anything left unclean.** An untracked file the sweep could not remove during a revert, or any
   path a revert left in an unexpected state. Every one with an **absolute path** and the command
   that recovers it.

8. **Uncommitted-state reminder.** One line that the sweep committed nothing, plus the touched set
   listed as the files the sweep edited. No file holds both user edits and sweep edits — a
   baseline-dirty file is never touched (condition 6) — so this list is exactly what the user is
   reviewing on top of their own in-flight work.

9. **Next steps.**
    - `/review-walk <absolute doc path>` — with the count it will walk (the surfaced findings; the
      terminal ones are already decided).
    - Then `/review-push` when `gh pr view --json number` finds an open PR for the current branch,
      or `/ship` when it does not.

**Zero implemented is a successful terminal state.** The report prints in full, the surfaced section
carries the run's value, and nothing about the wording treats it as a failure.

## Step 6: Stamp the Run

Fires on **every** terminal outcome — including zero implemented. A run that produced a report produced a stamp. Issue-number resolution (including the
silent skip when none resolves), posting mechanics, marker encoding, and failure handling are
defined in [the issue-log spec](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"review-sweep","event":"sweep-complete","implemented":<n>,"skipped":<n>,"surfaced":<n>,"paths":["docs/reviews/<file>.md"]} -->

### 🧹 /review-sweep — <n> implemented, <n> surfaced

**Doc:** docs/reviews/<file>.md
**Implemented:** <n> — <P1-2, P3-1>
**Won't fix:** <n> — <n> misread, <n> protected-artifact
**Surfaced:** <n> — left open for a human

<details><summary>Surfaced findings</summary>

- **P2-1 <title>** — <Sweep: reason>
- **P3-4 <title>** — <Sweep: reason>

</details>
```

```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

- The marker carries **counts only**: `implemented` is the `done` count, `skipped` is the `wont-fix`
  count, `surfaced` is the `open`-plus-`Sweep:` count. Titles and reasons are free text that can
  carry `--`, so they live in the body. Prior-decision and already-swept counts are body-only too —
  they are not this run's outcomes.
- Omit `**Won't fix:**` when nothing was closed out, and drop the `<details>` block when nothing was
  surfaced.
- With zero implemented the stamp still posts, reading `0 implemented, <n> surfaced`.

## Rules

- **User-invoked only** — by slash command or plain-English ask, either one. Never start it on your
  own initiative, and never from inside another skill.
- **Zero prompts.** Never ask a question, never offer a choice, never preview an edit for approval.
  Invoking the skill is the confirmation. A run that cannot proceed unattended stops with a stop
  message; it does not degrade into asking.
- **Never re-review.** The sweep consumes findings and produces none. It does not add findings to
  the doc, does not re-rank them, and does not second-guess a finding's P1/P2/P3 tier or its
  `Effort:` value — it only decides whether each one is cheap and certain enough to land.
- **Git and file writes are bounded by step 4's Files rule** — no commits, no `git add`, no new
  files, no issues filed, the stamp the only GitHub write. In addition: no `git stash`, no
  `git checkout` of a path the sweep did not itself edit this run, and no branch or history
  operation of any kind.
- **Every revert is patch-based.** Restore, then re-apply the saved patch. A bare `git checkout --`
  on a shared file would take an earlier finding's fix with it, and a `git stash pop` conflict is
  the one failure mode that can lose the user's work outright.
- **The `Sweep:` line sits directly under `Status:`**, one per finding for the life of the doc, with
  any other reason line following it. It is written on every finding the sweep decides, landed
  fixes included — it is the sweep's signature, and no other skill writes one.
- **The doc is the source of truth and is re-read before each edit.** Never write from a cached read
  of the doc, and never infer a finding's state from what the sweep remembers doing to it.
- **Report the real state.** Only claim a fix landed after the scope self-check passed. Every
  failure gets its absolute path and its recovery command in the report, never a silent swallow.
