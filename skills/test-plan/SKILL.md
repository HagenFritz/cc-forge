---
name: test-plan
description: >
  Produce a reviewable test plan for the current branch. Dispatches the three test
  lenses in parallel — spec (no file tools), blast-radius (full tools), surface (UI
  paths) — then hands their proposals to the test-synthesizer, which de-dupes, tags,
  scores, and writes the document to docs/tests/ with its Drop List. Stops once
  the document verifies; it runs nothing and writes no test files. Triggers on phrases
  like "write a test plan", "plan the tests for this branch", "test-plan", or passing a
  path to the plan this branch implements.
user-invocable: true
argument-hint: "[path to docs/plans/*.md]"
allowed-tools: Bash, Read, Write, Grep, Glob, Task
---

# Test Plan — The Producer

<command_purpose> Propose, filter, and record the test cases worth running for what changed on this branch, and stop for review. </command_purpose>

`/test-plan` obeys [the test-protocol spec](../test-protocol/SKILL.md) and embeds only its own prose: origin discovery, how it builds the surface digest, its lens briefs, its filled stamp template, and its terminal summary. Every shared rule — the roster, what each lens may see, the keep and drop rules, the revise bucket, the scratch contract, the count check, document verification, the report's shape — lives in the spec and is cited, never restated.

It is the **producer** half of the pair. It writes the document and stops; `/test-plan-run` is what acts on it.

## Prerequisites

Follow [the test-protocol spec](../test-protocol/SKILL.md#prerequisites) — it owns the git-repo baseline, resolving `docs/tests/` from the repo root, the gitignore posture, and the optional `cc-forge.local.md` keys.

This skill adds none of its own. It runs no tests and needs no runner: a repo with neither simply yields a browser-or-manual document.

## Input

<origin_plan> #$ARGUMENTS </origin_plan>

Split the argument into flags and a path: no flags are defined, so whatever remains is a path to the plan this branch implements. When a path is given, use it as rung 1 of the input ladder without discovery.

**When no path remains**, discover the origin by the ladder below.

## Main Tasks

### 1. Resolve the run's context

Run these before anything is dispatched:

- **Branch and repo root** — `git rev-parse --abbrev-ref HEAD` and `git rev-parse --show-toplevel`. The branch is the document's `target:` and the unsanitized slug; the root resolves `docs/tests/`.
- **Default branch** — the diff base for the digest and the blast-radius lens.
- **Origin documents** — the newest `docs/plans/*.md` whose frontmatter names this branch's issue or whose title matches the branch, and the brainstorm its `origin:` field names. An argument-supplied path skips this discovery.
- **Work doc** — per [the work-protocol readers rule](../work-protocol/SKILL.md#readers): the newest `docs/work/*.md` whose `target:` matches this branch. No match, or no doc, means none is passed — never a stop.
- **Linked issue and PR** — the issue number from the branch name, and `gh pr view --json number,body` for an open PR on this branch. Both are ladder rungs and the stamp's target.

### 2. Resolve the intent

Descend [the spec's spec-lens input ladder](../test-protocol/SKILL.md#spec-lens-input-ladder) over what step 1 found, and record which rung yielded text — the completion report and the lens brief both name it.

**The ladder's last rung is a stop.** With no plan, no brainstorm, no issue body, and no PR body, emit its stop message and end the run. Dispatch no lens, build no digest, write nothing.

Carry only the fields for the units this branch's diff touches, per [the brief-is-bounded rule](../test-protocol/SKILL.md#the-brief-is-bounded).

### 3. Build the surface digest

Build it yourself — no agent does. Follow [the spec's surface digest](../test-protocol/SKILL.md#the-surface-digest) for what each file class contributes and for the empty-digest case.

The extraction is grep-level, over `git diff --name-only <default-branch>...HEAD`, one entry per changed file. Read each source file at its post-change state and take the declaration lines only:

| Language | Lines taken |
|---|---|
| Python | `^\s*(async )?def `, `^\s*class `, `^[A-Z_]+ =` module constants, Pydantic/dataclass field lines |
| TypeScript / JavaScript | `export ` declarations, `function `, `class `, `interface `, `type `, `const <name> = (`, route and handler registrations |
| Go | `^func `, `^type ` |
| Rust | `^\s*pub (fn|struct|enum|trait)` |
| Shell | `^\w+\(\)` |
| Markdown, YAML, TOML, JSON, SQL, config, lockfiles, generated files | nothing |

A language not in the table contributes its top-level declaration lines by the same principle: the line that names the thing, never the block beneath it. **Stop at the opening brace or colon** — a signature's body never enters the digest, because the spec lens must not see it.

### 4. Discover the test conventions

One pass, recorded as plain text and passed to the lenses and the synthesizer:

- **Test directories** — `tests/`, `test/`, `spec/`, `__tests__/`, or whatever the repo actually uses. None found → record **"no test directory"** verbatim; the synthesizer reads that and tags zero cases `auto`.
- **Runner** — detect it with [`/land`'s ladder](../land/SKILL.md) (`package.json` scripts, `Makefile`, `pytest.ini`, `Cargo.toml`, and peers). None found → record "no runner detected".
- **Live-service markers** — the fixture names, decorators, or marks the repo uses for tests needing a database, queue, or network endpoint (`@pytest.mark.integration`, a `db` fixture, a `testcontainers` import). `/test-plan-run` greps for these; discovering them here puts them in the document's context rather than re-deriving them later.
- **Existing test file names** — file names only, no contents. The spec lens gets these in its brief because it cannot glob for them itself.

### 5. Dispatch the three lenses

All three in **one parallel batch**, per [the spec's three lenses](../test-protocol/SKILL.md#the-three-lenses). The roster is [the spec's](../test-protocol/SKILL.md#the-roster) — never add, substitute, or skip one.

Each brief carries exactly the values that lens's `## Inputs` section names, and nothing else. **A brief missing one of them is a broken dispatch, not a degraded one** — the spec lens in particular has no file tools and cannot fetch what the brief omits.

```
Task forge:test-plan:spec-lens(
  - the ladder-resolved requirements or plan fields, verbatim, bounded to this diff's units
  - the name of the rung they came from
  - the surface digest
  - the repo's test conventions
  - the file names of existing tests
)

Task forge:test-plan:blast-radius-lens(
  - the diff, or the base ref to diff against
  - the surface digest
  - the repo's test conventions
  - the work doc's absolute path, when step 1 found one
)

Task forge:test-plan:surface-lens(
  - the changed file paths
  - the surface digest
  - the repo's UI conventions, if step 4 found any
)
```

Never tell a lens to "read X" in place of putting X in its brief, and never hand the spec lens the diff, the work doc, a file path to open, or anything the digest excludes.

Handle an empty or failed lens by [the spec's lens-failure posture](../test-protocol/SKILL.md#lens-failure-posture).

### 6. Persist and synthesize

Persist each lens's raw returned output per [the spec's raw scratch contract](../test-protocol/SKILL.md#the-raw-scratch-contract) **before** dispatching the synthesizer, then [dispatch it](../test-protocol/SKILL.md#dispatching-the-synthesizer) with the six values its `## Inputs` section names, lens output attributed per lens so it can write `**Source:**`. Run [the count check](../test-protocol/SKILL.md#the-count-check) on what comes back, summing each lens's `Proposed: <n> cases` line plus the blast-radius lens's `Revise: <n> verdicts` line as the raw total.

The synthesizer is always-run infrastructure: never count it among the lenses and never list it in a roster.

### 7. Verify the document

Follow [the spec's verification section](../test-protocol/SKILL.md#verifying-the-document) — it owns every structural and freshness check, re-reading the verified file as the report's source of truth, and the scratch deletion gated on those checks passing. A dispatch that fails, or a document that fails a check, goes to [the spec's inline fallback](../test-protocol/SKILL.md#inline-fallback).

### 8. Report

Emit [the spec's completion report](../test-protocol/SKILL.md#the-completion-report) with `Test plan written` as the heading, filled from the verified document's own sections — the case table from its `### T-<NNN>:` blocks plus a `revise` row from its `### V-<NNN>:` blocks, `Dropped` from its `## Drop List`, `Lenses` from its frontmatter plus the rung that fed the spec lens. `Receipts` is empty on a producer run and the heading is never omitted.

**Read the counts; never assume a shape.** A document with zero surviving cases is a valid outcome — its Drop List is the whole of it — so the summary must hold up with no `### T-` or `### V-` block present.

Close with [the spec's next-steps block](../test-protocol/SKILL.md#the-next-steps-block), which ends this skill at "review the document, then `/test-plan-run`."

### 9. Stamp the linked issue

Follow [the spec's `test-plan-written` section](../test-protocol/SKILL.md#test-plan-written) — it owns when the stamp fires and the rule that a fallback-produced document posts none. Issue-number resolution (including the silent skip when none resolves), posting mechanics, marker encoding, and the never-fatal failure posture are [the issue-log spec's](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"test-plan","event":"test-plan-written","paths":["docs/tests/<filename>"]} -->

### 🧪 /test-plan — test plan written

**Doc:** `docs/tests/<filename>`
**Cases:** <n> auto / <n> browser / <n> manual / <n> revise
**Dropped:** <n>
**Lenses:** <which contributed; any empty or failed>
```

```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

## What this skill never does

- **It writes no test file and runs no test.** Both belong to `/test-plan-run`; the writer is never dispatched from here.
- **It never edits an existing document.** Each run writes a new one under the synthesizer's filename convention. Handing it a path to a `docs/tests/*.md` file is not a resume request — `/test-plan-run` is what resumes.
- **It never commits, pushes, or opens anything.** `docs/tests/` is a local artifact.
