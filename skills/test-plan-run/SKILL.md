---
name: test-plan-run
description: >
  Act on a reviewed test plan in one scope: `auto` writes the automated tests through the
  outside-observer test-writer and runs the assurance filters, `browser` drives the flows
  through Playwright or the Chrome tools, `manual` walks a human through the checks one
  card at a time. Records every verdict in the document — `Status:`, the `**Filter:**`
  signature line, and an appended `## Receipts` block — and reports the receipts rather
  than the sentence "tests pass". Triggers on phrases like "run the test plan", "run the
  auto tests", "walk the manual tests", "test-plan-run", or passing a path to a
  docs/tests/*.md file.
user-invocable: true
argument-hint: "[auto|browser|manual] [path to docs/tests/*.md]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, Task
---

# Test Plan Run — The Consumer

<command_purpose> Run one scope of a reviewed test plan, leave the evidence in the document, and report what actually ran. </command_purpose>

`/test-plan-run` obeys [the test-protocol spec](../test-protocol/SKILL.md) and embeds only its own prose: its argument parsing, how each mode drives its cases, its filled stamp template, and its terminal wording. Every shared rule — the preflights, the target-match gate, the assurance filters, the five `Status:` values, the `**Filter:**` grammar, the manual card, the receipts fields, the report's shape — lives in the spec and is cited, never restated.

It is the **consumer** half of the pair. `/test-plan` writes the document and stops; this skill is what acts on it, and it is the only skill that discovers an existing document to resume.

**Invoking is the confirmation.** There is no "proceed?" prompt and no per-case gate. `manual` mode asks a question per case because performing the case is the point; no other mode asks anything.

## Prerequisites

Follow [the spec's prerequisites](../test-protocol/SKILL.md#prerequisites) — the git-repo baseline, resolving `docs/tests/` from `git rev-parse --show-toplevel`, the gitignore posture, and the optional `cc-forge.local.md` keys this skill reads for the rerun count and the wall clock.

## Input

<scope_and_document> #$ARGUMENTS </scope_and_document>

Parse the argument as **a leading scope token, then a path**:

- The scope token is checked against the closed set `auto | browser | manual`. Whatever remains after it is a path to a `docs/tests/*.md` document.
- **No leading token** → run `auto`, then `browser`. This is the no-argument default, and each mode exits cleanly on zero cases of its tag per [the spec](../test-protocol/SKILL.md#zero-cases-in-a-mode-is-success), so the default is safe on any document. `manual` is never part of it: it needs a human at the keyboard and is always asked for by name.
- **A leading token that is not in the set and is not a path** → name it in one sentence and run the default, per [`/tldr`'s invalid-input shape](../tldr/SKILL.md). An unrecognized scope is not a stop; running nothing because of a typo is worse than running the default and saying so.
- **An argument that is only a path** → the default scope, over that document.

There is no `all` scope. `auto`, `browser`, and `manual` are the whole set, and a run covers one of them at a time.

## Main Tasks

### 1. Resolve the document

- **A path was given** → use it. Verify it exists with `ls`; a missing file is a stop naming the path.
- **No path** → auto-discover per [the spec's target-match gate](../test-protocol/SKILL.md#the-target-match-gate): the newest document under `docs/tests/` whose frontmatter `target:` matches the current branch — **never simply the newest file.**

  ```bash
  ls "$(git rev-parse --show-toplevel)"/docs/tests/*.md 2>/dev/null | sort -r
  ```

  Walk that list newest-first, reading each document's `target:`, and take the first match. The filename convention `YYYY-MM-DD-NNN-<slug>-test-plan.md` makes the sort deterministic.

- **No document matches this branch** → stop: "No test plan found for `<branch>` in `docs/tests/`. Run `/test-plan` first." Per [the spec's where-a-run-enters rule](../test-protocol/SKILL.md#where-a-run-enters), a missing document means the run belongs at the lenses, which is `/test-plan`'s job, not this skill's.

**Print the resolved absolute path and the scope as the first line of output**, before anything else:

```
Running <scope> over: /abs/path/to/docs/tests/<file>.md
```

Then read the document in full.

### 2. Preflight

Everything here runs **before any agent is dispatched, any test file is written, any browser session is driven, and any case is shown to a user.**

1. **Git.** `git rev-parse --show-toplevel` and `git rev-parse --abbrev-ref HEAD`. Not a git repository, or a detached `HEAD`, is a stop — the target gate compares against a branch name and has nothing to compare to.

2. **The target-match gate.** Apply [the spec's gate](../test-protocol/SKILL.md#the-target-match-gate) to the document's `target:` against the current branch. A mismatch **stops here**, naming both values — before the writer, before an edit, and without switching branches.

3. **Count the mode's cases.** Parse every `### T-<NNN>:` block and its `**Mode:**` field. Zero cases carrying this scope's tag exits the mode per [the spec](../test-protocol/SKILL.md#zero-cases-in-a-mode-is-success); on the no-argument path the run continues to the other mode rather than ending.

4. **Scope-specific, in the same pass:**
   - `auto` → detect the repo's test command with [`/land`'s ladder](../land/SKILL.md). Nothing detected → **stop** per [no runner, no writer](../test-protocol/SKILL.md#no-runner-no-writer), naming what was looked for. The writer is not dispatched.
   - `browser` → check whether Playwright or the Chrome tools are available this session. Neither → mark the mode's cases `blocked` and report it, per [no browser, no drive](../test-protocol/SKILL.md#no-browser-no-drive). This degrades; it never fails the run.
   - `manual` → nothing to check. A human is the runner.

### 3. Run the scope

#### `auto`

1. **Regenerate the surface digest** from the current tree, the way `/test-plan` builds it — [its step 3](../test-plan/SKILL.md) owns the per-language extraction, and [the spec](../test-protocol/SKILL.md#the-surface-digest) owns what each file class contributes. Differs from the one the document was written against → emit the one-line drift warning and continue.

2. **Re-derive the repo's test conventions** — test directories, runner, live-service markers, existing fixture names — the way `/test-plan` step 4 does. The document does not carry the markers, so they are derived here, not read.

3. **Select the cases to write.** Apply [the spec's re-run semantics](../test-protocol/SKILL.md#what-a-re-run-does) against the case IDs on disk: grep the test directories for each `auto` case's `T-NNN` ID. A case whose ID is already in a test file is **re-verified**, never rewritten, whatever its `Status:`; only the cases with no test on disk go to the writer. Every case already covered → dispatch no writer and go straight to the filters.

4. **Dispatch the writer** with exactly the five values its [`## Inputs` section](../../agents/test-plan/test-writer.md) names:

   ```
   Task forge:test-plan:test-writer(
     - the selected auto cases, verbatim, each with its T-NNN ID, title, steps, and expected result
     - the regenerated surface digest
     - the repo's test conventions
     - the test directories it may read, named explicitly
     - the existing fixture names
   )
   ```

   **The directory list is the writer's only path wall, for reads and writes alike** — neither tool can be path-scoped by the loader, so an unnamed directory is an unbounded one. Name them all, and name nothing outside the test tree. A returned path outside the list is not a file to keep: discard it, and report it with the case it came from.

   Its return carries files written with their case IDs, a per-test live-service hint, and a **"cases not written"** section. Lines in that section — including "left an existing file alone" — are **expected outcomes, not failures**: the first is a case the digest could not support, the second is [the file-on-disk-wins rule](../test-protocol/SKILL.md#what-a-re-run-does) working. Carry both into the report; neither stops the run.

5. **Run the filters** — [the spec's assurance filters](../test-protocol/SKILL.md#the-assurance-filters) own the three steps, their order, the rerun count, and the rule that only the new tests are run. Run them yourself; the writer holds no `Bash` and runs nothing.

   - Classify a collect failure and take the one fix round per [the spec](../test-protocol/SKILL.md#classifying-a-collect-failure-and-the-one-fix-round). A placement or import failure is re-briefed by you with the right directory; an assertion or syntax failure goes back to the writer.
   - Cap each rerun loop per [the rerun wall clock](../test-protocol/SKILL.md#the-rerun-wall-clock).
   - Derive the live-service flag yourself per [the spec](../test-protocol/SKILL.md#live-service-tests): grep each written test for the live-service markers step 2 found. The writer's per-test hint is advisory — on disagreement run the full reruns and say so in one report line.
   - When a second failure deletes a test and the writer's fix round said it believes **the code under test is wrong**, carry that sentence into the report verbatim. A discarded test whose author thought the code was broken is the most useful line in the run; swallowing it is how a real bug ships.

6. **Record the outcome per case** — a `Status:` value from [the spec's five](../test-protocol/SKILL.md#the-five-status-values) and a `**Filter:**` line in [the spec's grammar](../test-protocol/SKILL.md#the-filter-line), written directly under `Status:`, anchored on that case's `### T-<NNN>:` heading. One `**Filter:**` line per case: rewrite the existing one rather than adding a second.

7. **Leave the test files uncommitted.** `/ship` commits them. Never `git add`, never commit, never push, never stash.

#### `browser`

Drive each `browser` case through Playwright or the Chrome tools, in document order, one case at a time: perform its `**Steps:**`, compare against its `**Expected result:**`, and record a `Status:` from the spec's five. A case whose environment is unavailable is `blocked`, not `fail`.

A browser run writes **no `**Filter:**` line** — that slot is the assurance filters' signature and a driven flow has no filter behind it. Anything worth noting about a case goes in its `**Notes:**` field.

Receipts for a browser run carry the per-case outcome in place of a runner's counts; there is no command and no exit code to report, and the fields that do not apply are stated as not applicable rather than invented.

#### `manual`

Follow [the spec's presenting-a-case section](../test-protocol/SKILL.md#presenting-a-case) exactly — it owns the one-case-per-reply rule, the card, the four verbs, the numbered plain-text action line, the required free-text catch-all, and the self-loop. **Never call `AskUserQuestion`**, in this mode or anywhere in this skill.

Per [the spec](../test-protocol/SKILL.md#presenting-a-case), the user's verdict goes to that case's `Status:` and the user's own words go to its `**Notes:**` field, verbatim. **Never to the `**Filter:**` slot.** Write both before showing the next card, so an interrupted walk resumes from the document.

### 4. Append the receipts

Append one block to the document's `## Receipts` section per [the spec](../test-protocol/SKILL.md#the-documents-receipts-section), carrying [the receipts fields](../test-protocol/SKILL.md#the-receipts). **Append only** — never rewrite or remove an earlier run's block, and never trim the section. It is the document's run history, and a run that read it as scratch would destroy the evidence the previous run left.

Counts come from **real runner output**, parsed from what the command printed. An exit code of 0 is not a pass count.

### 5. Report

Emit [the spec's completion report](../test-protocol/SKILL.md#the-completion-report) with `Test run complete` as the heading, filled from the document as re-read after this run's writes:

- **Cases** — the table, from the document's `### T-<NNN>:` blocks and their current `Status:` values.
- **Receipts** — this invocation's block, the same fields just appended. Never the sentence "tests pass" on its own.
- **Dropped** — the discarded tests: the case ID and the filter that discarded it, plus the document's `## Drop List` rows.
- **Lenses** — from the document's `lenses:` frontmatter. This run dispatched none; it reports what the document records.

Add, below the table, any line this run owes the reader and the spec's sections do not hold: the digest drift warning, a live-service disagreement, the writer's "cases not written" lines, and a "the code under test may be wrong" sentence carried from a fix round.

Close with [the spec's next-steps block](../test-protocol/SKILL.md#the-next-steps-block), which ends this skill at `/ship`.

### 6. Stamp the linked issue

Follow [the spec's `tests-run` section](../test-protocol/SKILL.md#tests-run) — it owns the body's fields and the rule that **every terminal outcome stamps**, including a run that wrote nothing, ran nothing, or found zero cases in its mode. A stop before the preflight passes posts no stamp, because no run happened. Issue-number resolution (including the silent skip when none resolves), posting mechanics, marker encoding, and the never-fatal failure posture are [the issue-log spec's](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"test-plan-run","event":"tests-run","scope":"<auto|browser|manual>"} -->

### 🧾 /test-plan-run — tests run (`<scope>`)

**Doc:** `docs/tests/<filename>`
**Scope:** <auto | browser | manual>
**Result:** <n> pass / <n> fail / <n> blocked / <n> skip
**Receipts:** `<command>` → exit <code>, <n> passed
**Discarded:** <n> (<case id: filter>, …)
```

```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

A no-argument run that covered two modes stamps **once per mode**, each with its own `scope`, so the issue thread carries one durable marker per scope actually run.

## What this skill never does

- **It never rewrites a test on disk.** There is no `--rewrite` flag and no prompt that offers one. Deleting the file by hand is how a human asks for a rewrite.
- **It never runs the suite.** Only this run's new or re-verified tests, per the spec — CI runs the suite once, off `/ship`'s push.
- **It never commits, pushes, or stashes.** The tests land in the working tree and stay there.
- **It never dispatches a lens or the synthesizer.** A document that does not exist is `/test-plan`'s problem; this skill consumes one that does.
- **It never calls `AskUserQuestion`.** Every question is a plain-text numbered list with a free-text catch-all.
- **It never switches branches.** A `target:` mismatch is a stop, not a checkout.
