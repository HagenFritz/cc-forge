---
title: Deep review — /compact-prep skill
target: branch feat/compact-prep-skill
date: 2026-07-07
---

# Deep review — /compact-prep skill

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | 1 | Critical — fix before merge |
| P2 | 2 | Important — should fix |
| P3 | 2 | Nice-to-have |
| **Total** | 5 | |

### P1 Issues
- [x] **No write-verification before printing the resume reference** — Skill can print the `@`-reference and claim the safety net exists even if the doc write silently failed, defeating the skill's entire purpose at the worst possible moment.

### P2 Issues
- [x] **Gitignore "first time" trigger tests the wrong condition** — Uses directory-existence to gate a gitignore-content change; will misfire after this PR merges since Unit 2's static edit means the line is already present on every real "first invocation."
- [x] **Git-repo-absent and repo-broken-state fallbacks are underspecified** — Only the "pushed?" check has a defined fallback; the other five Phase 0 commands and the doc template have no "unknown" convention, risking inconsistent output across runs.

### P3 Issues
- [x] **Expository duplication across ~5 spots (~10% of file)** — Same three concepts (fresh-agent-first, question-gating logic, doc section list) each stated twice in adjacent sections.
- [x] **Untested false-positive question path in the plan's manual test scenarios** — All five scenarios test "ambiguity exists → question asked"; none test "no ambiguity → skill correctly stays quiet," which is the named success criterion most at risk for a prompt-driven skill.

---

## Groups

### G1: Docs/handoff/ gitignore idempotency

**Issues:** P1-1, P2-1

**Why grouped:** Both stem from the same root cause — Phase 2's gitignore-add instruction (SKILL.md:77) is guarded by the wrong condition (directory existence) instead of content existence (is the line already in `.gitignore`). P1-1 is the severe consequence variant applied to the doc-write path more broadly; P2-1 is the specific gitignore manifestation.

**Suggested order:** P2-1 → P1-1 (fixing the idempotency check first makes the write-verification fix simpler to specify precisely)

**Cascade:** Fixing P2-1's "check content before appending" pattern is the same defensive-check shape needed for P1-1's "verify before claiming success" — implement them together as one Phase 2 rewrite.

### G2: Underspecified fallback conventions

**Issues:** P2-2

**Why grouped:** Single-issue cluster — not written as a multi-issue group per the grouping rules, but noting here since it shares a theme (missing fallback specification) with G1's gitignore gap. No ordering dependency with G1.

**Suggested order:** Independent — can be fixed in any order relative to G1.

**Cascade:** independent fixes — no ordering dependency.

---

## Issues

### P1-1: No write-verification before printing the resume reference

**Status:** `done`

**Category:** reliability

**Confidence:** high

**Confidence rationale:** Directly traced: Phase 2 step 4 (SKILL.md:79-82) confirms the path unconditionally, and Phase 3 (SKILL.md:119-138) prints the `@`-reference with no gate checking that Phase 2 actually succeeded.

**File(s):** `skills/compact-prep/SKILL.md` (Phase 2 step 4, ~line 81; Phase 3, ~line 121)

**Plain English:** If writing the handoff doc fails for any reason — `docs/handoff/` can't be created, disk is full, a file already occupies that path — the skill in `skills/compact-prep/SKILL.md` has no instruction to check before it prints "Ready to compact" and the `@docs/handoff/[filename]` reference. The user compacts believing they have a safety net; after compaction, the reference resolves to nothing and the context the skill exists to preserve is gone with no recovery path.

**Problem:** This is the single failure mode that defeats the skill's entire purpose. Every other gap in this review degrades gracefully (wrong sequence number, missing gitignore line, inconsistent "unknown" text) — this one produces false confidence right before an irreversible action (`/compact`).

**Fix:** Add an explicit instruction after Phase 2 step 3 (the Write step): confirm the write succeeded (e.g., re-read the file or otherwise verify it exists at the expected path) before proceeding to Phase 3. If the write failed, stop and surface the error to the user instead of printing the resume reference. This mirrors the skill's own "don't over-claim verification" philosophy already applied to the `## Verification` section (R3b) — apply the same discipline to the skill's own output.

**Effort:** Small

---

### P2-1: Gitignore "first time" trigger tests the wrong condition

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Verified directly: `.gitignore` in this same PR (Unit 2, per `docs/plans/2026-07-07-001-feat-compact-prep-skill-plan.md`) already adds `docs/handoff/` unconditionally. Once merged, every real first invocation of the skill will find the directory absent but the gitignore line already present — the exact inverse of what SKILL.md:77's trigger checks for.

**File(s):** `skills/compact-prep/SKILL.md:77`

**Plain English:** The instruction "if you are creating [docs/handoff/] for the first time, add it to .gitignore" uses "directory doesn't exist yet" as the signal for "the gitignore line is missing." Those are different conditions. After this PR merges, the gitignore line will already exist independent of whether the directory does, so the stated trigger no longer reliably fires when it should — and offers no guard against appending a duplicate if it does fire.

**Fix:** Replace the directory-existence trigger with a content check: "Ensure `docs/handoff/` exists. If `.gitignore` does not already contain a `docs/handoff/` entry, append one." This matches the anti-duplicate guard the plan specified for Unit 2's own CLAUDE.md/.gitignore edit but never carried into the runtime SKILL.md instruction for the analogous case.

**Effort:** Small

---

### P2-2: Git-repo-absent and repo-broken-state fallbacks are underspecified

**Status:** `done`

**Category:** reliability

**Confidence:** high

**Confidence rationale:** Verified by reading Phase 0 directly: SKILL.md:51's "note git state as unknown and continue" fallback is textually attached only to the upstream/pushed check, not to the five commands listed at SKILL.md:44-48. The `## Git State` template (SKILL.md:109-113) defines no placeholder value for "unknown."

**File(s):** `skills/compact-prep/SKILL.md:44-51`, template at `skills/compact-prep/SKILL.md:109-113`

**Plain English:** Since this skill is prose interpreted by an LLM rather than code with defined error handling, an executing agent has to improvise what to write into `## Git State` if `git rev-parse`, `git log`, or `git status` fail (e.g., not a git repo, or mid-rebase). Nothing tells it what token or phrasing to use, so different runs could produce different-looking "failure" output — inconsistent with a doc whose whole purpose is a deterministic, reliable handoff.

**Fix:** Extend the existing fallback sentence to cover all five Phase 0 commands, not just the upstream check, and define one literal fallback phrase to write into the template (e.g., `branch: unknown (not a git repo)`). Optionally note that a mid-rebase/mid-merge state should be called out explicitly in `## Git State` rather than silently showing a plausible-looking but incomplete branch/commit.

**Effort:** Small

---

### P3-1: Expository duplication across ~5 spots (~10% of file)

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Directly compared against `skills/side-quest/SKILL.md` and `skills/brainstorm/SKILL.md`, which each state a given concept once; `skills/compact-prep/SKILL.md` restates the same ideas in adjacent sections in five identified spots.

**File(s):** `skills/compact-prep/SKILL.md` (intro ~lines 11-15 vs. Core Principles ~17-22; Interaction Rule 4 ~29 vs. Phase 1 preamble ~66-73; Phase 0 draft-list ~53-60 vs. template ~89-116; forward self-reference at ~29; Phase 3 closing sentence ~138 repeating intro line ~11)

**Plain English:** The same three ideas — "fresh agent is the primary reader," "ask R3a always, R3b/R3c only on real gaps," and "the doc has these seven sections" — are each explained fully in two different places in the file, forcing a reader to reconcile two descriptions of the same thing. `side-quest` and `brainstorm` (the two closest sibling skills) each state these kinds of concepts once.

**Problem:** Not a functional bug — R1 through R7 remain intact either way — but it inflates the file ~10% beyond what's needed and creates minor risk that a future edit updates one copy of an explanation without updating the other, letting them drift apart.

**Fix:** Trim the intro to 2-3 sentences and let Core Principles carry "fresh-agent-first" and "not a resume executor" once each. Delete Interaction Rule 4's restatement and let the Phase 1 preamble be the single source for the R3a/b/c gating logic. Collapse the Phase 0 draft-list to a one-line pointer at the template ("draft covers the same sections as the template below") plus elaboration only for the two sections with real embedded rules (Verification's non-fabrication rule, Where Things Live's "why it matters" note). Cut the forward self-reference `(Phase 1, R3a)` and the Phase 3 sentence that repeats the intro's `/compact`-can't-target-a-file fact.

**Effort:** Small

---

### P3-2: Untested false-positive question path in the plan's manual test scenarios

**Status:** `done`

**Category:** testing

**Confidence:** high

**Confidence rationale:** Verified against `docs/plans/2026-07-07-001-feat-compact-prep-skill-plan.md`'s Unit 1 test scenario list — all five listed scenarios test the positive case (ambiguity exists → question asked); none test the negative case.

**File(s):** `docs/plans/2026-07-07-001-feat-compact-prep-skill-plan.md` (Unit 1 test scenarios); behavior under test is `skills/compact-prep/SKILL.md` Interaction Rule 4 / Phase 1 (R3b, R3c)

**Plain English:** The skill's own success criterion (and Interaction Rule 4) is "ask R3b/R3c only when there's a real gap" — but every existing manual test scenario checks that a question gets asked when there IS a gap. None checks that the skill stays quiet on a clean, unambiguous session with no side threads, which is arguably the more likely failure mode for a prompt-driven skill (the "safe" default an LLM might drift toward is over-asking, not under-asking).

**Fix:** Add a manual test scenario to the plan (or to whatever verification checklist is used when validating this skill): invoke `/compact-prep` after a session with a single, clearly-completed task and no side investigations → confirm only the R3a next-step question is asked, with no ambiguity-confirmation or inclusion/pruning question surfacing.

**Effort:** Small
