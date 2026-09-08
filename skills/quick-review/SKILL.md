---
name: quick-review
description: >
  Lite multi-agent code review for a small diff. Runs a fixed, small roster —
  correctness-auditor, code-simplicity-reviewer, and at most one language reviewer
  chosen by the diff's dominant file extension — and produces a review document in
  the same docs/reviews/*.md format /deep-review produces, so /review-walk,
  /review-sweep, and /review-push consume it unchanged. Reviews the current branch
  in the current directory; never creates a worktree and never checks out a branch.
  Triggers on phrases like "quick review", "review this quickly", "light review",
  or /quick-review.
user-invocable: true
disable-model-invocation: true
argument-hint: "[PR number, GitHub URL, branch name, or latest]"
allowed-tools: Bash, Read, Write, Grep, Glob, Task
---

# Quick Review — Lite Multi-Agent Code Review

<command_purpose> Review a small diff with a fixed, small agent roster and produce a review document format-identical to `/deep-review`'s. </command_purpose>

`/quick-review` is the lite sibling of `/deep-review`. It obeys the same shared spec, dispatches the same synthesizer, and writes the same document — the only thing it trades away is depth: a fixed roster of two-or-three agents, no ultra-thinking, no conditional agents, no testing offer. Reach for it when the diff is small enough that the full fleet is overkill.

The review **document** format is non-negotiable and identical to `/deep-review`'s, because `/review-walk`, `/review-sweep`, and `/review-push` anchor on its structure.

## Prerequisites

Follow [the review-protocol spec](../review-protocol/SKILL.md#prerequisites) — it owns the baseline every review needs (git repo, authenticated `gh`, clean main/master, a path for document reviews).

This review adds none of its own. It needs no worktree permissions, because it never creates one.

## Main Tasks

### 1. Determine Review Target

<review_target> #$ARGUMENTS </review_target>

Follow [the review-protocol spec](../review-protocol/SKILL.md#determining-the-target) — it owns the argument-to-target mapping, the branch check, the PR-metadata fetch, the analysis-tool and security-scanning setup, and the rule that the code on disk must be the code being reviewed before any review agent is dispatched.

This review's working-tree policy is **review what is checked out here**:

- It reviews the current branch **in the current directory**. Arranging the working tree is not its job.
- It **never creates a worktree and never checks out a branch.** Neither `git worktree add`, nor `gh pr checkout`, nor any other switch.
- Running **inside** an existing `/tree` worktree is normal and fully supported — that worktree is simply the current directory. `/tree` symlinks `docs/`, so the review doc still lands in the primary checkout's real `docs/reviews/`.
- When the argument names a target that is **not** the branch checked out here, stop and say so — name the requested target and the current branch, and suggest `/tree` or a manual checkout. Create nothing, switch nothing, and dispatch no agents.

Creating isolation is `/deep-review`'s behavior, not a prerequisite for reviewing.

### 2. Protected Artifacts

Follow [the review-protocol spec](../review-protocol/SKILL.md#protected-artifacts) — it owns the protected paths and the rule that the synthesizer discards findings against them. Always pass that list in the synthesizer's dispatch.

### 3. The Roster

The roster is **fixed**. It is not read from `cc-forge.local.md`, not extended by conditional agents, and not configurable. Two agents always run; a third runs only when the diff has a dominant language this repo has a reviewer for.

**Always:**

```
Task forge:review:correctness-auditor(diff content) - Trace logic, boundaries, and contracts for behavior that doesn't match its claim
Task forge:review:code-simplicity-reviewer(diff content) - Identify YAGNI violations and simplification opportunities
```

**Plus at most one language reviewer**, chosen by the diff's dominant file extension:

| Extension group | Reviewer |
|---|---|
| `.ts`, `.tsx`, `.js`, `.jsx` | `forge:review:typescript-reviewer` |
| `.py` | `forge:review:python-reviewer` |
| anything else (Markdown, YAML, shell, Go, Rust, …) | none — no reviewer matches |

#### The dominance rule

**Dominant means the most files changed, not the most lines changed.** Count the changed files in each extension group; the group with the largest file count wins. A tie between a matching group and any other group breaks toward running the language reviewer.

Lines changed is deliberately not the measure — a single large generated, vendored, or lockfile-shaped file would otherwise pick the wrong reviewer for a diff whose real substance is elsewhere.

Worked examples:

- 7 `.ts` files, 1 `.md` file → `.ts` group is largest → dispatch `typescript-reviewer` (three agents total).
- 2 `.py` files, 3 `.md` files → the `.md` group is largest and matches no reviewer → dispatch the two always-run agents only.
- 2 `.py` files, 2 `.yaml` files → a tie between a matching group and a non-matching one → break toward the language reviewer → dispatch `python-reviewer`.
- 1 `.py` file changed by 4 lines, 1 `.ts` bundle changed by 9,000 lines → each group has one file, tie between two matching groups; lines are not the tiebreaker, so pick either matching reviewer and name the choice in the report.
- 12 `.md` files (this repo's own common case) → no group matches → dispatch the two always-run agents, and say so in `Review Agents Used`.

**Never substitute a mismatched reviewer to keep the count at three.** A missing language match means two agents ran, and the report says so.

Dispatch the selected agents in parallel. There is no serial mode.

### 4. Findings Synthesis and Review Document

#### Step 1: Dispatch the Review Synthesizer

Follow [the review-protocol spec](../review-protocol/SKILL.md#the-raw-findings-scratch-contract) — it owns the deterministic scratch path each review agent's raw findings are persisted to before synthesis, and why that write is the fallback's source of truth.

Follow [the review-protocol spec](../review-protocol/SKILL.md#dispatching-the-synthesizer) — it owns the dispatch shape and its input list, what the synthesizer owns and returns, the clean-review marker, and the rule that the synthesizer is always-run infrastructure. Then follow [its count sanity-check](../review-protocol/SKILL.md#sanity-checking-the-returned-counts) on what comes back.

This review's inputs to that dispatch:

- The findings to collect are those of the two or three roster agents this run dispatched.
- It passes **nothing** for the spec's optional "local review context" input. That input exists for a review that reads project-local review settings; this one has a fixed roster and deliberately never reads `cc-forge.local.md`, so it has no such context to pass.
- Because the synthesizer is always-run infrastructure, it is never counted as a roster agent.

#### Step 2: Verify the Review Document

Follow [the review-protocol spec](../review-protocol/SKILL.md#verifying-the-review-document) — it owns the clean-review case, what counts as a failed dispatch, the model-rejection-versus-retry split, every structural and freshness check on the written doc, and the scratch deletion gated on those checks passing. When it falls through, follow [its inline fallback](../review-protocol/SKILL.md#inline-fallback).

**Stamp the linked issue:** follow [the review-protocol spec](../review-protocol/SKILL.md#the-review-written-stamp) — it owns when the `review-written` stamp fires (and the clean-review and fallback cases that post none), the shared body below the marker heading, and the posting command. This review's filled template:

```markdown
<!-- cc-forge-log v1: {"skill":"quick-review","event":"review-written","paths":["docs/reviews/<filename>"]} -->

### ⚡ /quick-review — review written
```

#### Step 3: Summary Report

Follow [the review-protocol spec](../review-protocol/SKILL.md#the-completion-report) — it owns the terminal summary's template, the one-row-per-P1/P2 rule with the P3 roll-up, and the note that review docs are gitignored working artifacts. Close it with [the spec's next-steps block](../review-protocol/SKILL.md#the-next-steps-block), verbatim. Nothing follows that block — this review makes no further offers.

This review supplies its own `### Review Agents Used` section, between the Findings table and Next Steps ([the spec](../review-protocol/SKILL.md#the-review-agents-used-section) leaves its content to each review):

```markdown
### Review Agents Used

- correctness-auditor
- code-simplicity-reviewer
- [the matched language reviewer, if one ran — name the extension group that selected it]
- [if no language reviewer matched: "No language reviewer — the diff is dominated by <extension>, which no reviewer covers. Two agents ran."]
- [if any dispatched agent failed or returned nothing, name it here: "Did not complete: <agent> — coverage for its area is missing"]
- review-synthesizer (synthesis + document)
```

That line states the narrow coverage in the terminal report. The review document's format is shared with `/deep-review` so the consumers branch on nothing.

### Important: P1 Findings Block Merge

Follow [the review-protocol spec](../review-protocol/SKILL.md#important-p1-findings-block-merge) — it owns the rule that P1 findings block the merge and must be presented prominently.
