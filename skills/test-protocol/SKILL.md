---
name: test-protocol
description: >
  Shared specification for the test skills — test-plan, test-plan-run, and grind's
  mirrored test phase. Owns the rules all three obey identically: the three lenses and
  what each may see, the surface digest, the tag vocabulary, the keep and drop rules, the
  Drop List, the revise bucket, the scratch contract, the synthesizer dispatch and count
  check, the document shape, the assurance filters and revise execution, the re-run
  semantics, the receipts, the
  completion report, and the two stamps' shared bodies. Not user-invocable; the test
  skills cite it and restate none of it.
user-invocable: false
disable-model-invocation: true
---

# Test Protocol Specification (v1)

Three callers produce and consume one test-plan document: a producer that proposes cases,
a consumer that acts on them, and an autonomous path that mirrors both inline.

| Caller | Does | Produces |
|---|---|---|
| [`test-plan`](../test-plan/SKILL.md) | dispatches the three lenses and the synthesizer, stops for review | `docs/tests/*.md` |
| [`test-plan-run`](../test-plan-run/SKILL.md) | runs one scope (`auto`, `browser`, or `manual`) over an existing doc | `Status:`, `**Filter:**`, `## Receipts` in that doc; test files on disk |
| [`grind`](../grind/SKILL.md)'s test phase | mirrors both inline, between the last build unit and the PR open, with no doc-review step | the doc, the tests, and a commit carrying them |

This file is the single source of truth for every rule that applies to more than one of
them. Test skills embed only their own prose — origin discovery, how they build the
digest, their lens briefs, their own argument parsing, their own filled stamp template,
and their own terminal wording — and reference this spec for everything below. **Never
restate a rule from this file inside a test skill**, not even paraphrased.

Every rule here is written so all three callers can execute it. A rule that only
`/test-plan` could run, or that assumes a user is present, does not belong in this file.

Throughout, **the orchestrator** means whichever caller is running — it holds `Bash` and
runs every command; **lens** means one of the three proposing agents; **the writer** means
`forge:test-plan:test-writer`; **a case** means one `T-NNN` or `V-NNN` block in the
document; **a revise case** means a `V-NNN` block, per [the revise bucket](#the-revise-bucket).

## Scope and non-goals

- **Protected artifacts do not apply.** The review family's protected-paths rule exists
  because review agents produce findings against arbitrary paths. The test skills write
  only under `docs/tests/` and the repo's test directories, and produce no findings
  against any path, so there is nothing to protect them from.
- **The document has no `## Groups` section, by design.** Test cases carry none of the
  review family's cascade or fix-order semantics; each case stands alone.
- **The two document families never read each other.** Test docs and review docs anchor
  the same way (`### <ID>:` with a status field below) by convention, not for
  cross-consumption. `/review-walk`, `/review-sweep`, and `/review-push` never read
  `docs/tests/*.md`; `/test-plan-run` and grind's test phase never read
  `docs/reviews/*.md`.
- **Work docs are a third family, read one way.** `docs/work/*.md` belongs to
  [`work-protocol`](../work-protocol/SKILL.md), which owns its discovery and target match
  under [readers](../work-protocol/SKILL.md#readers). The test callers read only its
  `## Tests to Revisit` section, and only by passing the doc's path to the blast-radius
  lens; the spec lens never receives it. A work doc never reads a test doc.
- **This spec owns the document format**, unlike `review-protocol`, which delegates the
  format to its synthesizer. No single agent writes the whole test document: the
  synthesizer writes it and the run appends to it, so the format has to live where both
  can cite it.

## Prerequisites

- A git repository. `git rev-parse --show-toplevel` resolves the repo root; `docs/tests/`
  is always `<repo root>/docs/tests/`. Inside a `/tree` worktree that path is the
  symlinked `docs/`, so writes land in the primary checkout — which is correct and
  intended.
- GitHub CLI (`gh`) installed and authenticated, for the stamp only. An unauthenticated
  `gh` skips the stamp per [the issue-log spec](../issue-log/SKILL.md); it never stops a
  run.
- `docs/tests/` is gitignored. Test documents are local working artifacts, not committed
  repo content. The tests themselves are ordinary source files and are committed.
- `cc-forge.local.md` is **optional**. Its frontmatter may carry two keys this spec reads:

  | Key | Default | Meaning |
  |---|---|---|
  | `test_reruns` | `5` | Consecutive reruns a new test must pass to be kept |
  | `test_rerun_timeout` | `1m` | Wall-clock cap on one test's rerun loop |
  | `test_run_timeout` | `5m` | Wall-clock cap on the filter phase as a whole |

  The timeouts are deliberately tight, so a slow test is flagged early rather than
  absorbed. These defaults are stated here once. Every other site cites this table rather than
  repeating a number. A missing file, missing frontmatter, or a missing key takes the
  default silently — a stale `cc-forge.local.md` must keep working.

## The roster

The roster is **fixed and identical for every caller.** Unlike the review family, where
each review owns its own agent list because rosters vary by depth, there is exactly one
test roster and it lives here, so grind can cite it rather than re-enumerate it.

| Agent | Tools | Role |
|---|---|---|
| `forge:test-plan:spec-lens` | none (via `disallowedTools`) | proposes black-box behavior cases from the intent alone |
| `forge:test-plan:blast-radius-lens` | full | proposes regression cases for adjacent behavior |
| `forge:test-plan:surface-lens` | `Read, Glob, Grep, Bash` | proposes browser and manual cases from changed UI paths |
| `forge:test-plan:test-synthesizer` | `Read, Write, Glob, Grep` | de-dupes, tags, applies the keep and drop rules, formats the revise verdicts, writes the document |
| `forge:test-plan:test-writer` | `Read, Write, Glob, Grep` | writes the `auto` tests and applies revise cases; never runs anything |

**The synthesizer and the writer are always-run infrastructure** — never list either in a
caller's lens roster and never count either among the lenses whose output is synthesized.

**No caller adds, substitutes, or skips a roster agent.** A lens that fails is handled by
[the lens-failure posture](#lens-failure-posture), not replaced.

## The three lenses

The three lenses run **in parallel**, from one dispatch batch. Their value comes from
seeing different things, so the walls below are the design, not a precaution.

### Spec lens

Proposes black-box behavior cases: what the change is supposed to do, asserted at a
public boundary.

**May see:** the requirements or plan fields resolved by the input ladder below, the
[surface digest](#the-surface-digest), the repo's test conventions, and the file names of
existing tests.

**May not see:** the diff, any implementation body, or the repo at all. The wall is a
deny list: the agent is dispatched with every tool that reads a file, spawns a subagent,
or reaches the network denied by name, so its brief must be self-contained. A brief that
tells the lens to "read X" is a broken dispatch, not a degraded one. **The list holds only
for the tools it names** — a session that adds a tool with file or network reach has to add
it there before the wall holds again.

`Glob` over the test directories is deliberately withheld too: a diff-blind lens that can
list test files immediately after a change can reconstruct the blast radius from what is
*absent*, which defeats the wall. Existing test file names are already in the brief.

#### Spec-lens input ladder

The orchestrator resolves the intent by descending this ladder and stops at the first rung
that yields text:

1. The plan's `Goal` and `Requirements` fields.
2. The brainstorm's `Requirements` and `Success Criteria` sections.
3. The linked issue body.
4. The PR body.
5. **Stop**: "nothing describes the intended behavior; write a plan or an issue first."
   No lens is dispatched.

The completion report names the rung that fed the lens.

#### The brief is bounded

The brief carries only the requirements and plan fields for **the units this diff or slice
touches**, never the whole plan. A fourteen-unit plan must not produce a fourteen-unit
brief. The lens's output is judged case by case under
[the keep and drop rules](#keep-and-drop-rules); this rule bounds only what goes in.

### Blast-radius lens

Proposes regression cases for adjacent behavior the change could break.

**May see:** everything — the diff, the surrounding code, call sites, and the existing
tests. It is the only lens with full tools, and reading widely is its job.

**May not:** propose cases for the intended new behavior. That is the spec lens's output,
and duplicating it wastes the de-dupe budget rather than adding coverage.

**May receive:** the path of the branch's work doc, when [readers](../work-protocol/SKILL.md#readers)
finds one. It reads only `## Tests to Revisit` and returns a **revise verdict** per entry —
`update`, `delete`, or `still valid` — in a block separate from its regression cases. It
may add stale tests the entries missed, and should err broad: a stale test left alone
fails in CI, while one proposed and found `still valid` costs one gated run. With no work
doc it still proposes revise verdicts for any stale test it finds on its own. The verdict
is the lens's alone; see [the revise bucket](#the-revise-bucket).

### Surface lens

Proposes browser-drivable flows and manual UX checks for the UI paths the diff touches.

**May see:** the changed UI paths and the code around them (`Read, Glob, Grep, Bash`).

**Returns an explicit empty result** on a diff with no UI surface. Empty is the expected
outcome on a backend-only change; see [the lens-failure posture](#lens-failure-posture).

This is the rule behind R8: **the manual section exists only when the diff touches a UI
surface.** A pure backend diff produces no manual cases, because the only lens that
proposes them returned nothing.

## The surface digest

The orchestrator builds the digest — no agent does — from
`git diff --name-only <default-branch>...HEAD`, one entry per changed file, by file class:

| File class | Digest contents |
|---|---|
| Source files (any language) | function, method, and class signatures; exported names; route and endpoint declarations; type, schema, and interface definitions |
| Markdown, YAML, TOML, JSON, SQL, config, lockfiles, generated files | nothing |

**Bodies are never included.** A signature without its body is the public surface; the
body is the implementation the spec lens must not see.

The per-language extraction is grep-level and the orchestrator picks it; what matters is
that the output is signatures and names, never statements. A caller that adds or refines a
language's extraction records it in its own prose, not here.

**An empty digest is allowed.** A documentation-only or config-only diff produces one, and
the spec lens still runs as long as a requirements source exists — the intent is what it
tests against, not the surface. The blast-radius lens also still runs; it reads the diff
directly.

`/test-plan-run` and grind's phase **regenerate the digest from the current tree** and
report a one-line warning when it differs from the one the document was written against.
A drift warning never stops the run.

## Tagging

Every case carries exactly one tag, from a closed set:

| Tag | Meaning | Who drives it |
|---|---|---|
| `auto` | an automated test in the repo's runner | the writer, then the orchestrator's filters |
| `browser` | a flow driven through Playwright or the Chrome tools | `/test-plan-run browser` |
| `manual` | a check a human performs and reports | `/test-plan-run manual` |

There is no `all` tag and no untagged case. A revise case is always `auto`; its
`**Action:**` is a field, not a tag, and the set stays closed.

Every case block carries three fields the tag drives:

- `**Mode:**` — the tag itself: `auto`, `browser`, or `manual`.
- `**Source:**` — the lens that proposed it: `spec`, `blast-radius`, or `surface`. A case
  merged from two lenses names both, comma-separated.
- `**Viability:**` — the synthesizer's judgment of how much the case is worth:
  `Critical | High | Medium | Low | Negligible`. A case at `Low` or `Negligible` is a drop
  candidate under the rules below, not an automatic drop.

`auto` is only available in a repo that has a test runner. In a repo with no test
directory and no detectable runner, the synthesizer tags **zero** cases `auto`; every case
is `browser` or `manual`. (This repo is one of them.)

## Keep and drop rules

The synthesizer applies these, and only these. They are the whole of R7.

### Keep

A case is kept only if at least one holds:

- It exercises a changed line or branch **through a public boundary, with real
  collaborators**.
- It asserts an **error path of new code**.
- It is a **codebase-wide invariant** guard.

### Drop

A case is dropped, with its reason recorded in [the Drop List](#the-drop-list), if any
holds:

| Reason | What it catches |
|---|---|
| `pins a constant` | asserts a literal value that the code states once |
| `asserts a mock` | asserts that a mock was called, how often, or in what order |
| `duplicates existing` | an existing test already covers it |
| `jsdom focus/timing` | asserts focus, timing, or async rendering under jsdom |
| `unchanged code` | tests code the diff did not touch — never applied to a revise proposal |
| `still valid` | a revise proposal the blast-radius lens judged still valid |

**The jsdom retag.** A focus, timing, or async-rendering case is **never** kept as `auto`.
It is retagged `browser` when a real browser could drive it meaningfully, and dropped with
reason `jsdom focus/timing` otherwise. Retag first, drop second.

### The Drop List

One table, one row per dropped case, under a `## Drop List` heading in the document:

| Proposed case | Source | Reason | Note |
|---|---|---|---|
| `<the case title as proposed>` | `<lens>` | `<reason from the table above>` | `<one line: what made it match>` |

**The Drop List is never empty in a real run** and never omitted. A run that drops nothing
writes the heading with `_None — every proposed case was kept._` beneath it, so a reader
can tell "nothing was dropped" from "the section was skipped."

**Nothing is capped.** Every case that survives the keep rules is kept, in every mode —
`auto` included — and the revise bucket is uncapped too. The tight
[timeouts](#prerequisites) are what bound the run, not a count.

## The revise bucket

Existing tests the change made stale. They are not new cases, so they live apart from the
`T-NNN` cases, in their own section and ID space.

- **IDs are `V-NNN`**, numbered in their own sequence from `V-001`, under a `## Revise`
  heading in the document. `**Mode:**` is always `auto`.
- **Two extra fields**, both directly after `**Mode:**`:
  - `**Action:** update | delete` — `update` rewrites the named test for the new
    behavior; `delete` removes it.
  - `**Target test:** <path>::<test name>` — the path is absolute and repo-local; without
    `::<test name>` the target is the whole file.
- **The verdict is the blast-radius lens's.** It reads the work doc's
  `## Tests to Revisit` and the diff and decides `update`, `delete`, or `still valid` per
  entry. The synthesizer never sees the diff, so it de-dupes the verdicts by target and
  formats them, and never judges one: an `update` or `delete` becomes a `V-NNN` block; a
  `still valid` becomes a Drop List row with reason `still valid`.
- **The keep and drop rules do not re-judge a revise verdict.** `unchanged code` never
  applies — a revise target is by definition existing test code.
- **Uncapped**, like every other mode.
- Executed per [executing revise cases](#executing-revise-cases).

## The raw scratch contract

Before dispatching the synthesizer, persist each lens's raw returned output to one
deterministic path:

```
docs/tests/.raw/<sanitized-slug>/<lens>.md
```

using the same slug sanitization the synthesizer uses. `<lens>` is the dispatch name
(`spec-lens`, `blast-radius-lens`, `surface-lens`), so a scratch file maps to its lens by
name alone.

This is the fallback's source of truth — never rely on in-context memory surviving
compaction between lens dispatch and synthesis. The fallback re-derives the path from the
slug, so it works even when the write happened before a compaction.

`docs/tests/.raw/` is gitignored scratch, not a test artifact.

**Delete this run's scratch only after the document verifies** — `rm -rf
docs/tests/.raw/<sanitized-slug>/`. Never before, and never on the fallback path, which
reads from it.

### Inline fallback

When the synthesizer dispatch fails, read the lens outputs from the scratch files, not
from memory. Then locate the synthesizer's rules and template by trying, in order:

1. Read `${CLAUDE_PLUGIN_ROOT}/agents/test-plan/test-synthesizer.md`, if that env var resolves
   to a non-empty path this session.
2. Else `"$(git rev-parse --show-toplevel)"/agents/test-plan/test-synthesizer.md`.
3. If neither Read succeeds, present the raw proposed cases grouped by lens rather than
   exiting with no output.

Follow whichever resolved, and state in the completion report that the document was
produced by fallback, not the synthesizer.

**"Dispatch failed"** means the Task call returned an error or returned without a
`Doc path:` line. On a **model or spawn rejection** (the model pinned in
`agents/test-plan/test-synthesizer.md` frontmatter is not on the org's allowlist), do **not**
retry — a re-spawn with the same model fails identically. Emit one line naming that pinned
model and pointing at `agents/README.md` to repin, then go straight to the fallback. On
any other failure, retry the dispatch once, then fall inline.

## Dispatching the synthesizer

Collect every lens's output and dispatch a single synthesis task:

```
Task forge:test-plan:test-synthesizer(
  - every lens's proposed cases, verbatim
  - the surface digest
  - the repo's test conventions, and whether a test directory and runner exist
  - the target slug (the branch name, unsanitized)
  - the absolute path of this repo's docs/tests/ directory
  - today's date
)
```

The synthesizer's `## Inputs` section (`agents/test-plan/test-synthesizer.md`) is the
authoritative description of each value — **pass the values, not restatements of what they
mean.** It owns the filename convention
(`docs/tests/YYYY-MM-DD-NNN-<slug>-test-plan.md`) and sanitizes the slug the same way the
review synthesizer does, so `feat/foo` becomes `feat-foo`. It writes the document itself
and returns the document path plus the three counts below.

### The count check

After synthesis, check the returned counts. The three parts must close against the raw
proposed cases:

```
kept + dropped + merged  ≈  raw proposed
```

Revise proposals count as proposed cases: a `V-NNN` block is kept, a `still valid` row is
dropped.

A large shortfall means the payload overflowed the synthesizer's context and cases were
silently lost. On a shortfall, report it; a caller that can split the dispatch into
lens-ordered batches does so rather than re-issuing one oversized call.

## Verifying the document

On success, verify the document rather than trusting the return message:

- Confirm the returned path exists on disk.
- Grep it for the structural anchors every consumer needs: a `## Drop List` heading, a
  `## Receipts` heading, and at least one `### T-<NNN>:` or `### V-<NNN>:` heading with
  `**Status:**` on a line below it. A document holding only revise cases verifies; one
  holding any `V-NNN` block also carries a `## Revise` heading.
- Confirm the frontmatter `target:` matches this run's branch and `date:` matches today.
  This guards against a stale same-path document from an earlier run.
- Re-read the verified file as the source of truth for the completion report. Never report
  from the synthesizer's return message alone.
- Only once every check passes, delete this run's scratch.

A document that fails any check is treated as a failed dispatch: go to the inline
fallback.

## The document

One file per run, at `docs/tests/YYYY-MM-DD-NNN-<slug>-test-plan.md`.

### Frontmatter

```yaml
---
title: <one line naming the change under test>
target: <branch name>
date: YYYY-MM-DD
status: in-progress   # in-progress | complete
lenses: <which lenses contributed, and any that returned empty or failed>
---
```

`target:` is the **branch name** and is the gate every consumer checks before acting. See
[the target-match gate](#the-target-match-gate).

### Case blocks

```markdown
### T-001: <short descriptive title>

**Mode:** `auto`
**Source:** spec
**Viability:** High

**Steps:**
1. <what to do>
2. <what to do next>

**Expected result:** <what should happen when the change works>

**Status:** `untested`

**Notes:**
```

The `### T-<NNN>:` heading with `**Status:**` below it is the anchor every consumer edits
against. **A new per-case field goes below `**Status:**`, never between it and the
heading.**

### Revise blocks

Under `## Revise`, after the `T-NNN` cases:

```markdown
### V-001: <short descriptive title>

**Mode:** `auto`
**Action:** `update`
**Target test:** `/abs/path/tests/test_auth.py::test_refresh_expired`
**Source:** blast-radius
**Viability:** High

**Why:** <one sentence: what in the change made the target stale>

**Expected result:** <what the updated test asserts, or "removed" for a delete>

**Status:** `untested`

**Notes:**
```

`### V-<NNN>:` with `**Status:**` below it is an anchor exactly like `### T-<NNN>:`, and
the same field-placement rule holds. Every anchor rule in this spec accepts
`### (T|V)-<NNN>:`.

### The five `Status:` values

`untested | pass | fail | blocked | skip`

- `untested` — no run has decided this case. The initial value for every case.
- `pass` — the case was run and behaved as expected.
- `fail` — the case was run and did not.
- `blocked` — the environment to run it was unavailable. Belongs to `browser` and `manual`
  modes; an `auto` case is never `blocked`, because a missing runner stops the mode before
  any case is touched.
- `skip` — deliberately not run this time.

**Every mode may move a case to any of these values on every run; last run wins.** A case
whose test was discarded by a filter stays `untested` — a discarded test never ran, so it
never passed or failed.

### The `**Filter:**` line

The orchestrator's signature on every case whose test it decided, written **directly under
`Status:`**, exactly one per case for the life of the document:

```markdown
**Status:** `pass`
**Filter:** kept
```

```markdown
**Status:** `untested`
**Filter:** discarded — <which filter>
```

```markdown
**Status:** `pass`
**Filter:** reruns incomplete — <n>/<N>
```

```markdown
**Status:** `pass`
**Filter:** deleted
```

The first is the happy path and the most common line in any document: a test that collected,
passed, and passed its full reruns is `kept`, and it carries the line like every other
decided case. `kept` takes no detail — there is nothing to qualify.

Grammar: `**Filter:** <outcome>[ — <detail>]`, always one line. The outcomes are
`discarded`, `reruns incomplete`, `kept`, `deleted`, and `still valid`. A test discarded
before it ever ran, for reaching outside the repository, carries `discarded — forbidden
operation` and names the pattern that matched; one discarded for coming back from its fix
round with fewer assertions carries `discarded — assertions weakened`; one that never
reached pass before [the phase clock](#the-rerun-wall-clock) expired carries `discarded —
timeout`. `deleted` is a revise `delete` carried out; `still valid` is a revise `update`
whose original passed [the update gate](#the-update-gate), so nothing was rewritten — its
`Status:` is `pass`. This is the same signature-line-under-
`Status:` shape `/review-sweep` writes with `**Sweep:**` and `/grind` with `**Grind:**` —
a case carrying no `**Filter:**` line was decided by a human in `manual` mode or by a
browser run, not by the filters.

**The `**Filter:**` slot is never used for a user's words.** A verdict from `manual` mode
goes to `Status:` and the user's note to that case's `**Notes:**` field.

### The document's Drop List section

A `## Drop List` heading carrying the table specified in
[Keep and drop rules](#the-drop-list). Written once, by the synthesizer.

### The document's Receipts section

**Append-only.** Every run appends a block; no run rewrites or removes an earlier one, so
the section is the document's run history. Fields per
[the receipts](#the-receipts) below.

## The target-match gate

Before any source file is written, any browser session is driven, or any case is presented
to a user, read `target:` from the document's frontmatter and compare it to the current
branch.

- **Match** → proceed.
- **Mismatch** → **stop**, before the writer and before any edit, naming both values. Do
  not switch branches and do not act on the document. This mirrors `/review-sweep`'s
  `target:` stop.
- **Absent, empty, or unparseable** → warn in the completion report and proceed.

Auto-discovery (no document path given) picks the newest document under `docs/tests/`
whose `target:` matches the current branch. Lexicographic sort over the filename
convention picks the newest deterministically.

## The assurance filters

Filters run **in the orchestrator**, never in the writer. The writer has no `Bash`, which
is not a latency trade but the wall itself: `git log -p`, `git diff`, or `cat` on an
implementation file defeats the visibility wall regardless of what the writer is told. A
separate Bash-only runner subagent is deliberately not used — it adds a dispatch hop to
the highest-iteration path with no visibility benefit, since a runner never touches the
writer's context, and the orchestrator already holds `Bash`.

**Generated tests are not sandboxed.** They run in the user's shell with the user's
environment, credentials, and network — the same privileges `/work` has always had, stated
here because the code being run was written by an agent minutes earlier and read by no one.
Before a file is executed for the first time, the orchestrator greps it the way it already
greps for live-service markers, and **discards without running it** any test that reaches
outside the repository: an outbound network call to a host the repo's conventions do not
declare, a read of a credential path (`~/.ssh`, `~/.aws`, `~/.config/gh`, a `.env` outside
the repo), a write or delete outside the repo's test directories and the system temp
directory, or a spawned shell. The discard records `**Filter:** discarded — forbidden
operation` and names the pattern. This is a coarse grep, not a sandbox; it catches the
plausible accident, not a determined one.

Every newly written or updated test passes all three before it is kept:

1. **Collect or compile.** The test is discovered by the runner and the file parses.
2. **Pass.** The test runs green.
3. **N consecutive reruns.** The test passes `test_reruns` more times in a row (see
   [Prerequisites](#prerequisites) for the default).

**Breadth-first.** Steps 1 and 2 run for **every** new and updated test, fix rounds
included, before any test's reruns begin. The phase clock then spends itself on reruns,
never on a test that has not yet been seen to pass.

**Only the new and updated tests are run — never the suite.** Running the suite here would duplicate
the CI run that `/ship`'s push triggers, which is the whole reason the suite was taken out
of `/work`.

### Classifying a collect failure, and the one fix round

A failure at step 1 is classified before anything is re-dispatched. For a revise
`update`, "delete the file" below means [restore the target](#snapshot-and-restore) instead
— the file holds other tests.

- **Placement or import** (wrong directory, unresolvable import path, a fixture the repo
  keeps somewhere else) → the **orchestrator** re-briefs the writer once with the correct
  directory and import paths. This is the orchestrator's mistake, not the writer's.
- **Assertion or syntax** (the test itself is wrong) → the **writer** gets one fix round.

**One round, either way.** A second failure of the same test deletes the file and records
the discard. **The orchestrator does the deleting**, at the exact path the writer returned,
and confirms the path is gone before it writes the `**Filter:** discarded` line. A file left
on disk after a recorded discard is the worst outcome available: the document says the test
was thrown away and CI runs it anyway. If the path cannot be resolved or the file will not
delete, report the discard as incomplete and name the path rather than recording it as
done.

**The fix round is checked, not trusted.** The writer is told not to weaken an assertion to
go green, but it is told that by the same brief that says a second failure deletes its file,
and an empty test passes all three filters better than a real one — nothing about collect,
pass, or rerun determinism can tell `assert True` from an assertion. So before a fixed file
re-enters step 1, the orchestrator counts the assertions in it, in the repo's idiom, and
compares that against the version that failed — for a revise `update`, against the
writer's first draft of the update, never the original test, since an update may
legitimately drop assertions about removed behavior. A file that comes back with **fewer
assertions than it went in with, or with none at all**, is discarded rather than re-run,
with `**Filter:** discarded — assertions weakened`. This is the same principle as the
visibility wall: a rule the agent has every incentive to break is enforced by the caller,
not by the instruction. A failure at step 2 goes straight to the writer's one fix round; a failure at
step 3 is a flake and discards immediately, with no fix round — a test that passes
sometimes is exactly what the filter exists to catch.

### The rerun wall clock

The rerun loop is capped at `test_rerun_timeout` per test. A test that hits the cap is
**kept**, with `**Filter:** reruns incomplete — <n>/<N>` — it has already passed once, and
discarding on slowness would silently strip coverage from the repos that need it most.

**The per-test cap does not bound the phase.** The filter phase carries its own cap,
`test_run_timeout` (see [Prerequisites](#prerequisites)), measured across every test in
the run. When it expires:

- **Reruns are cut, nothing else.** A test that passed step 2 keeps `**Filter:** reruns
  incomplete — <n>/<N>`, `0/<N>` included.
- **A test that never reached pass is discarded.** The orchestrator deletes it — or
  [restores the target](#snapshot-and-restore), for an update — and records
  `**Filter:** discarded — timeout`. No never-run test is ever kept or shipped.
- **The report names every `discarded — timeout` case ID**, so the slow tests are the
  first thing a reader sees.

A caller that is itself clocked re-reads its own budget between tests rather than only
before the phase.

### Live-service tests

A test that needs a live service (a database, a queue, a network endpoint) **runs once**:
collect and pass, no reruns. Rerunning it costs minutes and proves nothing the first run
did not.

The flag is **orchestrator-derived**: grep the written test for the repo's live-service
markers and fixture names, discovered alongside the test conventions. The writer's own
per-test hint is advisory. **On disagreement, run the full reruns** and say so in one
report line — over-running a test costs time, under-running one lets a flake through.

## Executing revise cases

`V-NNN` cases run in `auto` mode alongside the `T-NNN` cases and pass through the same
filters, with four additions. A revise case is the **one exception** to
[a test on disk is never rewritten](#what-a-re-run-does): its named target, once.

### The update gate

Before the writer is dispatched for an `update`, the orchestrator runs the **original
target test** on the current tree — that one test, or that one file for a whole-file
target, never the suite.

- **It passes** → the change did not break it, and rewriting it would only hide whatever
  it guards. Nothing is rewritten; the case records `Status: pass` with
  `**Filter:** still valid`.
- **It fails** → the update proceeds to the writer.

This keeps an update from masking a regression: only a test the change already broke may
be rewritten to agree with the change.

### Snapshot and restore

Before the writer runs, the orchestrator copies each `update` and within-file `delete`
target file into this run's scratch, `docs/tests/.raw/<sanitized-slug>/revise/`, keeping
its repo-relative path.

A discarded update is **restored by the writer from the snapshot, touching only the named
test** (the whole file, for a whole-file target); the orchestrator then confirms that
only that test differs from the snapshot.
**Never `git checkout` or overwrite the whole file** — it may hold other tests this run
wrote, still uncommitted. The case stays `untested` with its `**Filter:** discarded — <which
filter>` line, like any discard.

The snapshot is scratch and is deleted with it, only after the run records every revise
outcome.

### Delete

- **Whole file** (no `::`) → the orchestrator deletes it and confirms the path is gone,
  the same precedent as a [discard](#classifying-a-collect-failure-and-the-one-fix-round).
- **One test within a file** → the writer removes that test and nothing else; the
  orchestrator confirms the rest of the file still collects.

Once the target is gone and any remaining file collects, the case records `Status: pass`
with `**Filter:** deleted`. A delete runs no pass step and no reruns — there is nothing
left to run.

### The join key

An updated test carries its `V-NNN` in its name or docstring, exactly as
[every test names its case](#every-test-names-its-case). That ID on disk is what tells a
re-run the update already happened.

## Preflights

Both run before any agent is dispatched or any file is written.

### No runner, no writer

Scope `auto` detects the repo's test command with
[`/land`'s ladder](../land/SKILL.md) — `package.json` scripts, `Makefile`, `pytest.ini`,
`Cargo.toml`, and peers. **Nothing detected → stop**, naming what was looked for, before
the writer is dispatched.

The same absence upstream means `/test-plan` tags zero cases `auto` at all, so a repo with
no runner produces a browser-or-manual document and `auto` has nothing to run.

### No browser, no drive

Scope `browser` checks that Playwright or the Chrome tools are available this session.
**Neither available → mark the mode's cases `blocked`** and report it. This degrades; it
never fails the run, because tool availability is a session property the document cannot
know.

### Zero cases in a mode is success

Each mode counts its tag first. Zero cases → report "no `<tag>` cases in this document"
and exit that mode cleanly. On the no-argument path the run continues to the other mode.
Zero is never an error.

## Resume

Both `/test-plan-run` and grind's `testing` rung enter here.

### Where a run enters

- **No document matches the current branch** → enter at the lenses: the document does not
  exist yet and must be produced before anything can be run.
- **A document matches** → enter at the writer (or at the mode's driver). The lenses do
  not re-run; the document is the record of what they proposed.

### What a re-run does

- **A case at `pass` whose test file exists on disk is re-verified, never rewritten.** The
  filters run again against the existing file; the writer is not dispatched for it.
- **A case at `untested` or `fail` with no test on disk is written.**
- **A case at `untested` or `fail` whose test file exists is re-verified, not rewritten.**
  The file on disk always wins.
- **A `V-NNN` `update` whose ID is on disk is re-verified, never re-updated.** Its ID
  absent → [the update gate](#the-update-gate) runs again.
- **A `V-NNN` `delete` whose target is already gone** re-checks collection of the
  remaining file, if any, and nothing more.
- **There is no rewrite path.** No flag, no argument, no prompt rewrites a test file that
  exists. Deleting the file by hand is how a human asks for a rewrite. The one exception
  is a revise case naming the test, [once](#executing-revise-cases).

Case IDs are the join key for all of this, which is why
[every written test names its case](#every-test-names-its-case).

### Every test names its case

The writer puts the case ID (`T-NNN`, or `V-NNN` for an updated test) in each test's
name or docstring. That is how
receipts map a runner's output back to cases, how a re-run knows which cases already have
a test on disk, and how the test-coverage reviewer tells a spec-sourced test from a
diff-sourced one. A test with no case ID is not resumable.

## Presenting a case

`manual` mode only. It follows `/review-walk`'s post-#117 contract, and the rules below
are the whole of it.

**Invoking the mode is the confirmation.** There is no "proceed?" prompt, no "ready?"
prompt, and no per-section gate.

**One case per reply.** Never collapse several cases into one message, never offer a batch
verdict, never skip a card because the answer looks obvious. The mode exists so each case
is actually performed.

The card:

```
### T-<NNN>: <title>
Mode: manual  ·  Source: <lens>  ·  Viability: <level>
Steps:
1. <step>
2. <step>
Expected: <one sentence>

1. pass
2. fail
3. blocked
4. skip
— or just tell me
```

- **Every summary line on the card follows [`/tldr`'s rules](../tldr/SKILL.md) with
  N = 1.** Short common words, active voice, no hedging. Identifiers, error strings, and
  file paths stay exact and are never paraphrased. One sentence is the ceiling, not a
  target.
- **The action line is plain text, never `AskUserQuestion`,** with a blank line above it.
  The user answers with the number, the verb, either plus a qualifier, or something else
  entirely.
- **The catch-all is required.** A reply the four verbs do not cover is answered in as few
  sentences as it needs, and then the action line is shown again — a self-loop that does
  not advance the case.

Then stop and wait.

**Where the reply lands:** the verdict goes to the case's `Status:`; the user's own words
go to that case's `**Notes:**` field, verbatim. **Never to the `**Filter:**` slot** — that
slot is the orchestrator's signature and a human verdict has no filter behind it.

## The receipts

`## Receipts` in the document and the receipts section of the completion report carry the
same fields. **Never the sentence "tests pass" on its own** — a claim with no evidence
behind it is what the receipts exist to replace.

Per run:

- **Command** — the exact command run, verbatim.
- **Exit code** — the integer the command returned.
- **Passed / failed** — counts read from **real runner output**, never inferred from the
  exit code.
- **Reruns** — per test: `T-NNN: <n>/<N>` (or `V-NNN`), or `live-service: 1 run` for a
  test that ran once by [the live-service rule](#live-service-tests).
- **Revised** — per revise case: `V-NNN: updated`, `V-NNN: deleted`, or `V-NNN: still
  valid at the gate`, with the gate command for an update.
- **Discarded** — per discarded test: the case ID and the filter that discarded it; every
  `discarded — timeout` case is named.

The block is appended, never rewritten. An earlier run's receipts stay exactly as written.

## The completion report

All three callers emit this. The sections and field names are fixed here; only the prose
wording is the caller's own.

````markdown
## ✅ <Test plan written | Test run complete>

**Target:** <branch> **Document:** `docs/tests/<filename>`

### Cases

| Mode | Total | untested | pass | fail | blocked | skip |
|---|---|---|---|---|---|---|
| auto | n | n | n | n | n | n |
| browser | n | n | n | n | n | n |
| manual | n | n | n | n | n | n |
| revise | n | n | n | n | n | n |

### Receipts

<the fields above, one block per run this invocation performed>

### Dropped

<the Drop List rows, or "none">

### Lenses

<which lenses contributed; any that returned empty or failed, and the input-ladder rung
that fed the spec lens>
````

A producer run reports empty `Receipts` — nothing has been run yet — and never omits the
heading.

### The next-steps block

Each caller ends at a different place, and each states only its own:

- `/test-plan` → "review the document, then `/test-plan-run`."
- `/test-plan-run` → `/ship`.
- grind's test phase → **nothing.** It continues to its own next phase; a next-steps block
  in an unattended run is noise.

A caller may **append** its own follow-on offer after this block; it never rewrites the
line above it.

## The stamps

Both events are registered in [the issue-log spec](../issue-log/SKILL.md). Issue-number
resolution (including the silent skip when none resolves), posting mechanics, marker
encoding, and the never-fatal failure posture are defined there and are not repeated here.
Each writer keeps its own filled template carrying its own `"skill"` value and glyph, per
that spec's writer-fills-its-own-template convention.

### `test-plan-written`

One writer: `/test-plan`. Posted once the document has passed every verification check —
the same gate that deleted the scratch. A **fallback-produced document posts no stamp**;
the stamp attests to a verified document.

It is a document-producing event, so the body starts with `**Doc:**` and the marker
carries `paths`. The body below the marker heading:

```markdown
**Doc:** `docs/tests/<filename>`
**Cases:** <n> auto / <n> browser / <n> manual / <n> revise
**Dropped:** <n>
**Lenses:** <which contributed; any empty or failed>
```

### `tests-run`

Two writers: `/test-plan-run` and `/grind`'s test phase, on the `unit-complete`
two-writers precedent. `/test-plan-run`'s marker additionally carries `scope` (the mode it
ran). Grind posts it inside the test phase, so an interruption mid-phase leaves a durable
marker to resume from.

The body is the same in both, and nothing else belongs in it:

```markdown
**Doc:** `docs/tests/<filename>`
**Scope:** <auto | browser | manual>
**Result:** <n> pass / <n> fail / <n> blocked / <n> skip
**Revised:** <n> updated / <n> deleted / <n> still valid
**Receipts:** `<command>` → exit <code>, <n> passed
**Discarded:** <n> (<case id: filter>, …)
```

Both terminal outcomes stamp — including a run that wrote nothing, ran nothing, or found
zero cases in its mode. A stop before the preflight passes posts no stamp, because no run
happened.

## Lens-failure posture

- **Surface lens empty** → expected, and **unreported**. A backend diff has no UI surface;
  saying so every time trains the reader to ignore the line.
- **Spec or blast-radius lens empty or failed** → **proceed with partial coverage.** Name
  the lens in the document's `lenses:` frontmatter and in the stamp. Never re-dispatch a
  substitute and never stop the run: a document with two lenses' cases is worth more than
  no document.
- **All three empty or failed** → no document is written; report which failed and stop.

## Rules every test run inherits

- **Visibility is structural, not instructed.** The spec lens's file, subagent, and network
  tools are denied by name and its brief is self-contained; the writer gets no `Bash`.
  Never "tell" an agent not to look at something it has the tools to reach — and keep the
  deny list current, because it only covers the tools it enumerates.
- **The orchestrator runs every command.** The writer writes and the lenses propose;
  nothing but the orchestrator executes.
- **The roster is fixed and lives here.** Never re-enumerate the lenses, the synthesizer,
  or the writer in a caller — cite [the roster](#the-roster).
- **Persist raw lens output to scratch before dispatching**, and delete it only after the
  document verifies — never on the fallback path, which reads from it.
- **Never claim a document was written until it verifies.** Confirm it exists, carries the
  anchors the consumers need, and is this run's rather than an earlier one's.
- **Check `target:` before any write.** A document from another branch is never acted on.
- **A test on disk is never rewritten** — except once, by a revise case naming it. A
  re-run re-verifies what exists and writes only what is missing.
- **An update needs a failing original.** A target that passes the gate is `still valid`
  and is never rewritten.
- **Restore a discarded update from the snapshot, one test only.** Never `git checkout` a
  whole file.
- **Only the new and updated tests are run, never the suite.** The gate runs one original
  test. CI runs the suite once, off `/ship`'s push.
- **Breadth-first: every test reaches pass before any reruns.** The phase clock cuts only
  reruns; a test that never passed is discarded as `timeout`, never shipped.
- **Nothing is capped.** Not `auto`, not the revise bucket.
- **The revise verdict is the blast-radius lens's.** The synthesizer formats it; the spec
  lens never sees the work doc.
- **Every kept test names its case.** `T-NNN` or `V-NNN`; without the ID, receipts and
  resume have no join key.
- **Receipts, never "tests pass."** The command, the exit code, the counts from real
  runner output, the reruns, and the discards.
- **A discarded test leaves its case `untested`.** It never ran, so it never failed.
- **Zero cases in a mode is success.** Report it and move on.
- **Every terminal outcome stamps**, including one that ran nothing.
