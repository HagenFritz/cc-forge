---
name: test-protocol
description: >
  Shared specification for the test skills — test-plan, test-plan-walk, test-plan-run,
  and grind's test plan. Owns the rules they obey identically: the three lenses and
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

Four callers produce and consume one test-plan document: two producers that propose cases
— one stopping for review, one autonomous — and two consumers: a walk that judges each
case and a run that acts on them.

| Caller | Does | Produces |
|---|---|---|
| [`test-plan`](../test-plan/SKILL.md) | dispatches the three lenses and the synthesizer, stops for review | `docs/tests/*.md` |
| [`test-plan-walk`](../test-plan-walk/SKILL.md) | walks every `T-NNN` case with a human, keep or cut, before any run | `**Walk:**` in that doc |
| [`test-plan-run`](../test-plan-run/SKILL.md) | runs one scope (`auto`, `browser`, or `manual`) over an existing doc | `Status:`, `**Filter:**`, `## Receipts` in that doc; test files on disk |
| [`grind`](../grind/SKILL.md)'s test plan | dispatches the three lenses and the synthesizer after its review and fixes, before the PR opens; writes no tests and commits nothing | `docs/tests/*.md` |

This file is the single source of truth for every rule that applies to more than one of
them. Test skills embed only their own prose — origin discovery, how they build the
digest, their lens briefs, their own argument parsing, their own filled stamp template,
and their own terminal wording — and reference this spec for everything below. **Never
restate a rule from this file inside a test skill**, not even paraphrased.

Every rule here is written so each caller it applies to can execute it. A rule that only
`/test-plan` could run does not belong in this file, and a rule that needs a user present —
`manual` mode, the walk — names the caller it binds.

Throughout, **the orchestrator** means whichever caller is running — it holds `Bash` and
runs every command; **lens** means one of the three proposing agents; **the writer** means
`forge:test-plan:test-writer`; **a case** means one `T-NNN` or `V-NNN` block in the
document; **a revise case** means a `V-NNN` block, per [the revise bucket](#the-revise-bucket).

## Scope and non-goals

- **Protected artifacts do not apply.** The review family's protected-paths rule exists
  because review agents produce findings against arbitrary paths. The test skills write
  only under `docs/tests/` and the repo's test directories, and produce no findings
  against any path, so there is nothing to protect them from.
- **The two document families never read each other.** Test docs and review docs anchor
  the same way (`### <ID>:` with a status field below) by convention, not for
  cross-consumption. `/review-walk`, `/review-sweep`, and `/review-push` never read
  `docs/tests/*.md`; `/test-plan-run` and grind's test plan never read
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
- `cc-forge.local.md` is **optional**. Its frontmatter may carry three keys this spec reads:

  | Key | Default | Meaning |
  |---|---|---|
  | `test_reruns` | `5` | Consecutive reruns a new test must pass to be kept |
  | `test_timeout` | `5s` | Wall-clock cap on any single run of one test — its first run or any rerun |
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
| `forge:test-plan:test-writer` | `Read, Write, Glob, Grep` | writes the `auto` tests and removes a within-file `delete`'s named test; never runs anything |

**The synthesizer and the writer are always-run infrastructure** — never list either in a
caller's lens roster and never count either among the lenses whose output is synthesized.
The writer is dispatched only by `/test-plan-run auto`; the producers never dispatch it.

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

The brief carries only the requirements and plan fields for **the units this diff touches**
— for grind, the units of the phase it built — never the whole plan. A fourteen-unit plan
must not produce a fourteen-unit brief. The lens's output is judged case by case under
[the keep and drop rules](#keep-and-drop-rules); this rule bounds only what goes in.

### Blast-radius lens

Proposes regression cases for adjacent behavior the change could break.

**May see:** everything — the diff, the surrounding code, call sites, and the existing
tests. It is the only lens with full tools, and reading widely is its job.

**May not:** propose cases for the intended new behavior. That is the spec lens's output,
and duplicating it wastes the de-dupe budget rather than adding coverage.

**May receive:** the path of the branch's work doc, when [readers](../work-protocol/SKILL.md#readers)
finds one. It reads only `## Tests to Revisit` and returns a **revise verdict** per entry —
`delete`, `regression`, or `still valid` — in a block separate from its regression cases. It
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

`/test-plan-run` **regenerates the digest from the current tree** and
report a one-line warning when it differs from the one the document was written against.
A drift warning never stops the run.

## Tagging

Every case carries exactly one tag, from a closed set:

| Tag | Meaning | Who drives it |
|---|---|---|
| `manual` | a check that needs human judgment — appearance, layout, copy quality, empty-state clarity | `/test-plan-run manual` |
| `browser` | interaction and exact outcomes — click, type, navigate, drag, then assert what appears, including exact rendered strings — driven through Playwright or the Chrome tools | `/test-plan-run browser` |
| `auto` | logic that needs no DOM — hooks, reducers, formatters, state transitions — as an automated test in the repo's runner | the writer, then the orchestrator's filters |

A case that asserts anything about the UI is never `auto`: it is `browser` when the outcome
is exact and `manual` when it needs judgment. **Tag first, then keep, then drop.**

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

A case is kept only if at least one holds, and its `**Keep rule:**` names the label of the
first that does:

- `changed behavior` — it exercises a changed line or branch **through a public boundary,
  with real collaborators**.
- `new error path` — it asserts an **error path of new code**.
- `invariant guard` — it is a **codebase-wide invariant** guard.

### Drop

A case is dropped, with its reason recorded in [the Drop List](#the-drop-list), if any
holds:

| Reason | What it catches |
|---|---|
| `pins a constant` | asserts a literal value that the code states once |
| `asserts a mock` | asserts that a mock was called, how often, or in what order |
| `duplicates existing` | an existing test already covers it |
| `UI test in fake DOM` | asserts a UI behavior through jsdom or another simulated DOM that a real browser should own |
| `tests untouched code` | asserts only behavior of code the diff did not touch — see the adjacent-risk test below |
| `library already guarantees it` | asserts what a library or framework guarantees rather than what the change decided — a query-param bound the framework enforces, a type the schema library rejects |
| `still valid` | a revise proposal the blast-radius lens judged still valid |

No drop reason re-judges a revise proposal; only `still valid` drops one.

**The adjacent-risk test.** A blast-radius case that is not an invariant guard is kept only
when its `**Why:**` names a changed line or branch and the call path by which the change
reaches the asserted behavior — such a case exercises the change even when the assertion
lands in code the diff left alone. "The change sits near X, so X still works" is
`tests untouched code`: it re-proves behavior the existing suite already owns.

### Folding

Cases that share one **shape** — the same setup, the same entry point family, the same
assertion template — and differ only in **input and expected values** are folded into one
case whose `**Steps:**` list the rows ("Rows: title → `title_changed`; due date →
`due_changed`; …"). The writer turns a folded case into **one parametrized test**, one row
per listed row, so a failure still names the row that broke.

- Fold on shape, not on topic: "every field edit writes its event" folds; "an edit writes its
  event" and "the timeline pages newest first" do not.
- A row keeps every specific assertion its source case carried — folding never drops an
  assertion, it only removes the per-case test scaffolding.
- Fold after the keep and drop rules, within one `**Mode:**`, and never a revise case.
- Folding is not capping. It changes the unit from one test per behavior to one test per
  shape; every surviving behavior is still asserted.

### The Drop List

One table, one row per dropped case, under a `## Drop List` heading in the document:

| Proposed case | Mode | Source | Viability | Reason | Note |
|---|---|---|---|---|---|
| `<the case title as proposed>` | `<tag>` | `<lens>` | `<level>` | `<reason from the table above>` | `<one line: what made it match>` |

The reasons are spelled exactly as in the table above; `/test-plan-walk`'s cut codes 1–6
reuse them byte for byte, so a walk cut and a synthesizer drop count together.

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
  - `**Action:** delete | regression`:
    - `delete` — the test covers code the change removed, or behavior a plan Requirement
      or unit intentionally changed. Its `**Why:**` cites the removed code or the
      Requirement or unit. Nothing is rewritten: the new behavior's test is the spec
      lens's ordinary `T-NNN` case.
    - `regression` — the test fails and no removed code or intended change explains it:
      the test is right and the code is wrong. Never touched; left to fail in CI.
  - `**Target test:** <path>::<test name>` — the path is absolute and repo-local; without
    `::<test name>` the target is the whole file, which only a `delete` may name.
- **The verdict is the blast-radius lens's**: `delete`, `regression`, or `still valid`
  per entry. The synthesizer never sees the diff, so it de-dupes the verdicts by target
  and formats them, and never judges one: a `delete` or `regression` becomes a `V-NNN`
  block; a `still valid` becomes a Drop List row with reason `still valid`.
- **The keep and drop rules do not re-judge a revise verdict.** `tests untouched code` never
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
dropped. A case [folded](#folding) into another counts as merged.

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
**Keep rule:** changed behavior
**Why:** <one line: why this case is worth running>

**Steps:**
1. <what to do>
2. <what to do next>

**Expected result:** <what should happen when the change works>

**Status:** `untested`

**Notes:**
```

The `### T-<NNN>:` heading with `**Status:**` below it is the anchor every consumer edits
against. **Fields the synthesizer writes sit above `**Status:**`; a field a run adds goes
below it, never between it and the heading.** The one exception is the walk's
`**Walk:**` line, which sits directly under the heading so the walk can anchor on it alone.

### Revise blocks

Under `## Revise`, after the `T-NNN` cases:

```markdown
### V-001: <short descriptive title>

**Mode:** `auto`
**Action:** `delete`   <!-- delete | regression -->
**Target test:** `/abs/path/tests/test_auth.py::test_refresh_expired`
**Source:** blast-radius
**Viability:** High

**Why:** <one sentence: a `delete` cites the removed code or the plan Requirement or unit that changed the behavior; a `regression` names what the change broke>

**Expected result:** <"removed" for a delete; the behavior the test still asserts for a regression>

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
  modes, and to a revise case whose [gate](#the-gate) was inconclusive; a `T-NNN` `auto`
  case is never `blocked`, because a missing runner stops the mode before any case is
  touched.
- `skip` — deliberately not run this time.

**Every mode may move a case to any of these values on every run; last run wins.** A case
whose test was discarded by a filter stays `untested` — a discarded test never ran, so it
never passed or failed.

**A cut case is out of every run.** A `T-NNN` case whose `**Walk:**` line begins `cut` is
never written, run, re-verified, presented, or counted, and no run changes its `Status:`;
a test already on disk for it is left alone. The block stays in place; nothing is
renumbered.

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
`discarded`, `reruns incomplete`, `kept`, `deleted`, `still valid`, `regression`, and
`blocked`. A test discarded
before it ever ran, for reaching outside the repository, carries `discarded — forbidden
operation` and names the pattern that matched; one discarded for coming back from its fix
round with fewer assertions carries `discarded — assertions weakened`; one that never
reached pass before [the phase clock](#time-limits) expired carries `discarded —
timeout`, and one whose single run passed `test_timeout` carries `discarded — slow`. The last four belong to revise cases, per [the gate](#the-gate): `deleted` is a
`delete` carried out (`Status: pass`); `still valid` is a target that passed the gate, so
nothing was touched (`Status: pass`); `regression` is a `regression` whose target failed
the gate, left untouched (`Status: fail`); `blocked — <reason>` is an inconclusive gate
(`Status: blocked`). This is the same signature-line-under-
`Status:` shape `/review-sweep` writes with `**Sweep:**` and `/grind` with `**Grind:**` —
a case carrying no `**Filter:**` line was decided by a human in `manual` mode or by a
browser run, not by the filters.

**The `**Filter:**` slot is never used for a user's words.** A verdict from `manual` mode
goes to `Status:` and the user's note to that case's `**Notes:**` field.

### The `**Walk:**` line

`/test-plan-walk`'s record of a human verdict, written directly under the case's heading
per [the case-block rule](#case-blocks), exactly one per walked `T-NNN` case:

```markdown
### T-003: Archive-all keeps rank order
**Walk:** pending
```

```markdown
### T-004: Sort param rejects unknown fields
**Walk:** keep
```

```markdown
### T-005: Toast confirms the sort change
**Walk:** cut — UI test in fake DOM — asserts the toast text under jsdom; T-007 drives it in a browser
```

Grammar: `**Walk:** pending | keep | cut — <code> — <text>`, always one line. `pending` is
the walk's claim, written before the card renders; `keep` and `cut` are the verdicts, and a
`cut` makes the case [a cut case](#the-five-status-values). The cut codes are owned by the walk; codes 1–6
are [the drop reasons](#drop), spelled identically. A case with no `**Walk:**` line was
never walked.

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

Every newly written test passes all three before it is kept:

1. **Collect or compile.** The test is discovered by the runner and the file parses.
2. **Pass.** The test runs green.
3. **N consecutive reruns.** The test passes `test_reruns` more times in a row (see
   [Prerequisites](#prerequisites) for the default).

**Breadth-first.** Steps 1 and 2 run for **every** new test, fix rounds
included, before any test's reruns begin. The phase clock then spends itself on reruns,
never on a test that has not yet been seen to pass.

**Only the new tests are run — never the suite.** Running the suite here would duplicate
the CI run that `/ship`'s push triggers, which is the whole reason the suite was taken out
of `/work`.

### Classifying a collect failure, and the one fix round

A failure at step 1 is classified before anything is re-dispatched.

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
compares that against the version that failed. A file that comes back with **fewer
assertions than it went in with, or with none at all**, is discarded rather than re-run,
with `**Filter:** discarded — assertions weakened`. This is the same principle as the
visibility wall: a rule the agent has every incentive to break is enforced by the caller,
not by the instruction. A failure at step 2 goes straight to the writer's one fix round; a failure at
step 3 is a flake and discards immediately, with no fix round — a test that passes
sometimes is exactly what the filter exists to catch.

### Time limits

**Every single run of a test is capped at `test_timeout`** — its first run and each
rerun. A run that hits the cap is killed; the test is deleted and recorded
`**Filter:** discarded — slow`. The slow test is the one flagged, never a test queued
behind it.

**`test_run_timeout` is a backstop across the whole run.** When it expires:

- **Reruns are cut, nothing else.** A test that passed step 2 keeps `**Filter:** reruns
  incomplete — <n>/<N>`, `0/<N>` included.
- **A test that never reached pass is discarded.** The orchestrator deletes it and records
  `**Filter:** discarded — timeout`. No never-run test is ever kept or shipped.

**The report names every `discarded — slow` and `discarded — timeout` case ID**, so the
slow tests are the first thing a reader sees.

### Live-service tests

A test that needs a live service (a database, a queue, a network endpoint) **runs once**:
collect and pass, no reruns. Rerunning it costs minutes and proves nothing the first run
did not.

The flag is **orchestrator-derived**: grep the written test for the repo's live-service
markers and fixture names, discovered alongside the test conventions. The writer's own
per-test hint is advisory. **On disagreement, run the full reruns** and say so in one
report line — over-running a test costs time, under-running one lets a flake through.

## Executing revise cases

`V-NNN` cases run in `auto` mode alongside the `T-NNN` cases. None is ever rewritten, and
none passes through the assurance filters — there is no new test to filter.

### The gate

Before anything else happens to a `V-NNN` case, the orchestrator runs its **original
target** once on the current tree: the one test, or the whole file for a whole-file
`delete` — never the suite.

- **Passes** → `Status: pass`, `**Filter:** still valid`. Nothing is deleted.
- **Fails** — a clean test failure, or a collection error from a removed module → the
  action proceeds: [delete](#delete) or [regression](#regression).
- **Anything else** — no tests collected, a bad test ID, an environment error, a timeout →
  nothing is touched; `Status: blocked`, `**Filter:** blocked — <reason>`.

### Delete

- **Whole file** (no `::`) → only when the whole file failed the gate, and only when the
  path is inside the test directories the writer is given; a path outside them is not
  deleted and the case is `blocked`. The orchestrator deletes it and confirms the path is
  gone, as for a [discard](#classifying-a-collect-failure-and-the-one-fix-round).
- **One test within a file** → the orchestrator copies the file to
  `docs/tests/.raw/<sanitized-slug>/revise/`, keeping its repo-relative path; the writer
  removes the named test and nothing else; the orchestrator confirms the rest of the file
  still collects. If it does not, the writer restores the file from that snapshot — never
  `git checkout`, never a whole-file delete — and the case records `Status: blocked`,
  `**Filter:** blocked — remaining file does not collect`. The snapshot is scratch,
  deleted once every revise outcome is recorded.

A done delete records `Status: pass`, `**Filter:** deleted`.

### Regression

Never touched and never sent to the writer. A target that failed the gate records
`Status: fail`, `**Filter:** regression`, and is left for CI and the human to see.

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

`/test-plan-run` enters here.

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
- **A `V-NNN` `delete` whose target is already gone** re-checks collection of the
  remaining file, if any, and nothing more. Any other `V-NNN` case goes through
  [the gate](#the-gate) again.
- **There is no rewrite path.** No flag, no argument, no prompt rewrites a test file that
  exists. Deleting the file by hand is how a human asks for a rewrite.

Case IDs are what tie a test on disk to its case, which is why
[every written test names its case](#every-test-names-its-case).

### Every test names its case

The writer puts the case ID (`T-NNN`) in each test's name or docstring; a folded case's
parametrized test carries its one ID, with the rows as parameter ids. That is how
receipts map a runner's output back to cases, how a re-run knows which cases already have
a test on disk, and how the test-coverage reviewer tells a spec-sourced test from a
diff-sourced one. A test with no case ID is not resumable.

## Presenting a case

`manual` mode only. It follows `/review-walk`'s post-#117 contract,
and the rules below are the whole of it.

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
- **Reruns** — per test: `T-NNN: <n>/<N>`, or `live-service: 1 run` for a
  test that ran once by [the live-service rule](#live-service-tests).
- **Revised** — per revise case: `V-NNN: deleted`, `V-NNN: still valid`, `V-NNN:
  regression`, or `V-NNN: blocked — <reason>`, with the gate command.
- **Discarded** — per discarded test: the case ID and the filter that discarded it; every
  `discarded — timeout` case is named.

The block is appended, never rewritten. An earlier run's receipts stay exactly as written.

## The completion report

The two producers and `/test-plan-run` emit this; the walk ends with its
[walk-protocol](../walk-protocol/SKILL.md) summary instead. The sections and field names are fixed here; only the prose
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

- `/test-plan` → "review the document, walk it with `/test-plan-walk` if you want, then
  `/test-plan-run`."
- `/test-plan-run` → `/ship`.
- grind → its own terminal report owns its next steps.

A caller may **append** its own follow-on offer after this block; it never rewrites the
line above it.

## The stamps

Both events are registered in [the issue-log spec](../issue-log/SKILL.md). Issue-number
resolution (including the silent skip when none resolves), posting mechanics, marker
encoding, and the never-fatal failure posture are defined there and are not repeated here.
Each writer keeps its own filled template carrying its own `"skill"` value and glyph, per
that spec's writer-fills-its-own-template convention.

### `test-plan-written`

Two writers: `/test-plan` and grind's test plan, on the `unit-complete` two-writers
precedent. Posted once the document has passed every verification check — the same gate
that deleted the scratch. A **fallback-produced document posts no stamp**;
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

One writer: `/test-plan-run`. Its marker additionally carries `scope` (the mode it ran).
The body below the marker heading, and nothing else belongs in it:

```markdown
**Doc:** `docs/tests/<filename>`
**Scope:** <auto | browser | manual>
**Result:** <n> pass / <n> fail / <n> blocked / <n> skip
**Revised:** <n> deleted / <n> still valid / <n> regression
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
- **A test on disk is never rewritten.** A re-run re-verifies what exists and writes only
  what is missing. The one exception: a within-file `delete` removes one named test.
- **Every revise case passes [the gate](#the-gate) first.** Only a failing target is
  deleted or recorded `regression`; a passing one is `still valid` and untouched.
- **Only the new tests are run, never the suite.** The gate runs one original target. CI
  runs the suite once, off `/ship`'s push.
- **Breadth-first: every test reaches pass before any reruns.** The phase clock cuts only
  reruns; a test that never passed is discarded as `timeout`, never shipped.
- **Nothing is capped.** Not `auto`, not the revise bucket.
- **The revise verdict is the blast-radius lens's.** The synthesizer formats it; the spec
  lens never sees the work doc.
- **Every kept test names its case.** Without its `T-NNN`, receipts and resume cannot
  find it.
- **Receipts, never "tests pass."** The command, the exit code, the counts from real
  runner output, the reruns, and the discards.
- **A discarded test leaves its case `untested`.** It never ran, so it never failed.
- **A cut case is out of every run.** A case whose `**Walk:**` begins `cut` is never
  written, run, presented, or counted.
- **Zero cases in a mode is success.** Report it and move on.
- **Every terminal outcome stamps**, including one that ran nothing.
