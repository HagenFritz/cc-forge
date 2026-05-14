---
date: 2026-05-14
topic: review-grouping-and-walkthrough
---

# Review Doc Improvements + Guided Walkthrough

## Problem Frame

Today's `/review` workflow produces a P1/P2/P3 issue list, but the user's execution loop has three pain points:

1. **Related issues are scattered across P-levels**, so fixes get made in the wrong order or duplicate effort. Cascades (fixing P1-1 changes the right answer for P2-3) are missed.
2. **Some issues go over the user's head**, leading to blindly accepting fixes without understanding what was flagged. Learning suffers.
3. **Some flagged issues aren't real issues**, but there's no signal to skip them quickly.

The user's manual workaround — compact conversation, switch to Sonnet, step through one-by-one — is slow, loses cascade insight, and provides no scaffolding for learning.

The solution splits across two artifacts: a **better review document** (richer fields the reviewer fills in at write-time) and a **new guided walkthrough skill** that consumes that document interactively.

## Requirements

### Review Document Improvements (`/review`)

- **R1.** Each issue gets a `Category:` field. Allowed values: `security`, `correctness`, `performance`, `architecture`, `duplication`, `maintainability`, `testing`, `docs`. (Eight categories; `style` dropped as low-signal.)
- **R2.** Each issue gets a `Confidence:` field (`high` | `medium` | `low`) and a one-line `Confidence rationale:` set by the reviewing agent at finding-time, based on whether the agent could verify the issue from the code it saw.
- **R3.** Each issue gets a `Plain English:` field (1–3 sentences) that explains what's wrong in non-jargon terms, ideally with a concrete reference to the user's actual code (e.g., "your code at `auth.rb:42` does X, which means Y").
- **R4.** The review document gains a top-level `## Groups` section listing clusters that span P-levels. Each group has: a name, the member issue IDs, a `Why grouped:` rationale, a `Suggested order:`, and a `Cascade:` note flagging when fixing one issue affects another. Issues still keep their `P1-1`, `P2-3` IDs and their existing self-contained structure — grouping is additive, not a reorganization.
- **R5.** Groups are produced during synthesis (Step 1 of the existing Findings Synthesis phase), after dedupe and severity assignment, before the review file is written.

### Guided Walkthrough Skill (`/review-walk`)

- **R6.** Invoked once with a review doc path (or auto-discovers the latest review doc in `docs/reviews/`). Drives the rest of the session from conversation context — no re-invocation needed per issue.
- **R7.** Walks **group-by-group**, not strictly issue-by-issue. For each group: presents the cluster summary, then teaches the underlying concept in plain English with a concrete example from the user's code, then steps through member issues in the group's `Suggested order:`.
- **R8.** Per issue, offers four actions: **implement** (apply the fix now), **defer** (mark as out-of-scope to revisit later), **skip** (won't-fix; usually for low-confidence noise), **explain more** (deeper teach-moment before deciding).
- **R9.** Updates the review doc inline as the user moves: sets each issue's `Status:` to `in-progress`, `done`, `deferred`, or `wont-fix`. The doc is the durable state — resuming a walkthrough means re-reading the doc and continuing from unfinished items.
- **R10.** Surfaces low-confidence issues with a clear marker ("reviewer flagged this with low confidence — likely safe to skip if it doesn't match your read of the code") so the user can move past noise fast.
- **R11.** When the user picks **defer**, the skill captures a one-line reason in the doc so future-them knows why it was punted.
- **R12.** Resumable: invoking `/review-walk <path>` on a partially-walked doc picks up at the first issue whose `Status:` is still `open`.

## Success Criteria

- A typical review-and-walk cycle no longer requires manual compacting or model switching to feel manageable.
- The user can articulate, in their own words, what each implemented issue was about — the plain-English field and group teach-moment make this the default outcome, not a stretch.
- Cascade-aware ordering means the user rarely fixes an issue only to find a related one is now moot or differently-shaped.
- Low-confidence noise is dispatched in seconds, not minutes of investigation.

## Scope Boundaries

- **Not** reorganizing the review doc around groups (issues stay grouped by P-level in their main section; `## Groups` is additive).
- **Not** building a second-pass "noise filter" agent. Confidence is assigned inline by the reviewing agent at finding-time. We will revisit if low-confidence findings still feel noisy after using this for a few cycles.
- **Not** changing how `/review` orchestrates agents, runs in parallel/serial, or handles worktrees/PR setup.
- **Not** adding a `style` category — too low-signal given the agents in use.
- **Not** building a separate "improvement tracker" — deferred issues live in the review doc with `Status: deferred`, no new file format.

## Key Decisions

- **Two artifacts, not one.** Improving the doc and improving execution are separate concerns. Conflating them would bloat `/review` and still leave execution unstructured.
- **Confidence is set by the reviewer, not a separate pass.** Same-model self-review is unreliable; inline rationale forces the original agent to be honest about what it could verify.
- **Group-first walk, not issue-first.** The user's biggest stated pain is missing cross-P-level relationships. Walking by group makes the cascade visible by construction.
- **Doc is the state.** No separate progress file, no SQLite, no JSON. `Status:` fields in the review doc are the source of truth, which makes resume trivial and keeps the artifact portable.
- **Eight categories, fixed list.** Open-ended categories drift and lose meaning. Fixed list keeps filtering and future tooling tractable.

## Dependencies / Assumptions

- The existing review template (`docs/reviews/YYYY-MM-DD-NNN-*-review.md`) and stable IDs (`P1-1`, `P2-3`) remain the contract `/review-walk` reads against. If the doc shape changes, the walkthrough must be updated in lockstep.
- Reviewing agents (`security-sentinel`, `performance-oracle`, etc.) can be instructed via the synthesis step to emit `Category`, `Confidence`, `Confidence rationale`, and `Plain English` fields. We do **not** need to modify each agent definition — the synthesis prompt enforces the fields when writing the doc.

## Outstanding Questions

### Resolve Before Planning

_None._

### Deferred to Planning

- [Affects R5][Technical] Should grouping be done by the synthesizing model in the existing Step 1, or by a dedicated lightweight "grouper" sub-task? Likely the former for simplicity, but worth a brief check during planning.
- [Affects R6][Technical] Auto-discovery rule for the latest review doc — newest by filename date+sequence, or by `mtime`? Resolve when implementing.
- [Affects R9][Technical] Exact Status state machine and how to render `Status:` updates non-destructively in the doc (preserve everything else verbatim). Standard edit-in-place; worth confirming during planning.
- [Affects R7][Needs research] When teaching the concept for a group, should `/review-walk` always re-read the cited files to ground the example, or trust what the reviewer already wrote? Probably re-read for accuracy; planning should decide the cost/benefit.

## Next Steps

→ `/plan` for structured implementation planning. Recommend planning `/review` updates first (R1–R5), since `/review-walk` (R6–R12) depends on the new fields existing.
