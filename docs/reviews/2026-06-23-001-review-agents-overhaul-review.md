---
title: Review of new/split review agents + skill rewiring
target: branch main (uncommitted working tree)
date: 2026-06-23
---

# Review of new/split review agents + skill rewiring

Editorial review of this session's changes: 5 new bug-hunter agents, security/performance split into python/typescript variants, kieran→language reviewer renames, generalized lint, two deletions, doc updates. These are Markdown prompt files, not executable code — so the review is for consistency, overlap, and dead references, not runtime safety.

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | 0 | Critical — fix before merge |
| P2 | 3 | Important — should fix |
| P3 | 3 | Nice-to-have |
| **Total** | 6 | |

### P2 Issues
- [ ] **Retry-storm + dual-write coverage duplicated across agents** — adversarial / reliability / data-integrity will report the same finding; assign single owners.
- [ ] **`<examples>` blocks are dead weight** — 5 agents carry ~14 lines each of dispatch examples that restate their own `description`; the running agent is already selected.
- [ ] **Stale `/ce:plan` `/ce:work` refs in code-simplicity-reviewer** — leftover upstream prefix, wrong for this repo.

### P3 Issues
- [ ] **adversarial-reviewer §4 restates §2/§3** — cuttable.
- [ ] **Heading-casing split across the two agent sub-families** — Title Case vs sentence-case; cosmetic.
- [ ] **lint still lists Ruby in its detect list** — consistent with "language-agnostic" but worth a conscious keep/drop.

---

## Groups

### G1: Cross-agent finding duplication

**Issues:** P2-1, P3-1

**Why grouped:** Same root cause — overlapping scopes between adversarial-reviewer, reliability-engineer, and data-integrity-guardian on concurrency, retries, and partial-commit. Fixing the scope boundaries (P2-1) also resolves the §4 redundancy (P3-1).

**Suggested order:** P2-1 → P3-1

**Cascade:** Assigning single owners in P2-1 determines what's left to cut in adversarial §4.

---

## Issues

### P2-1: Retry-storm and dual-write coverage duplicated across three agents

**Status:** `done`

**Category:** duplication

**Confidence:** high

**Confidence rationale:** Both reviewer agents independently flagged it; confirmed by reading the section bodies.

**File(s):** `agents/review/adversarial-reviewer.md` (§2 Race Conditions, §3 Cascade Failures), `agents/review/reliability-engineer.md` (§2 Timeouts and Retries, §3 Partial Failure), `agents/review/data-integrity-guardian.md` (§1 Transaction Boundaries)

**Plain English:** Three agents cover the same ground. Retry storms appear in both `adversarial-reviewer.md` §3 and `reliability-engineer.md` §2. The "step 2 fails after step 1 succeeded → inconsistent state" case appears in both `reliability-engineer.md` §3 and `data-integrity-guardian.md` §1. When `/deep-review` runs all three, the same problem gets written up two or three times.

**Problem:** Duplicate findings inflate the review doc and make triage noisier. The "different lens" justification is thin for retry storms (identical concern) and dual-write (identical concern).

**Fix:** Scope the three apart in their prompt bodies: reliability-engineer owns timeouts/retries and in-flight process failure; data-integrity-guardian owns persisted-state invariants and transaction boundaries; adversarial-reviewer owns concurrency *exploits* (TOCTOU, double-process under a hostile/racing caller). Add one line to each agent's intro stating what it does NOT own, pointing at its sibling. IDOR/authz also overlaps adversarial §1 and security-sentinel — note that adversarial defers authz to security-sentinel when a language reviewer is in the roster.

**Effort:** Small

---

### P2-2: `<examples>` blocks add length without instruction

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Read all five blocks; each is user-line + assistant-line + commentary that restates the `description`.

**File(s):** `agents/review/correctness-auditor.md`, `agents/review/reliability-engineer.md`, `agents/review/adversarial-reviewer.md`, `agents/review/test-coverage-reviewer.md`, `agents/review/data-integrity-guardian.md` (each `<examples>` block)

**Plain English:** Each of these five agents opens with a two-example `<examples>` block (~14 lines) showing a user asking and the assistant choosing the agent. By the time the file loads, the agent is already selected, so the running model gains nothing from them — the trigger already lives in the `description` frontmatter. The security/performance/language variants have no such blocks and read fine.

**Problem:** ~70 lines of prompt that the active agent doesn't use, inconsistent with the leaner half of the directory.

**Fix:** Delete the `<examples>` blocks from all five bug-hunter agents. Keep the `description` field as the dispatch trigger. Do not add examples to the variants that lack them. Note: this mirrors the upstream compound-engineering style (examples inherited from there) — dropping them is a deliberate divergence.

**Effort:** Small

---

### P2-3: Stale `/ce:plan` and `/ce:work` references in code-simplicity-reviewer

**Status:** `done`

**Category:** docs

**Confidence:** high

**Confidence rationale:** Grep-confirmed at line 51; CLAUDE.md documents the skills as `/plan` and `/work` (no `ce:` prefix).

**File(s):** `agents/review/code-simplicity-reviewer.md` (line 51)

**Plain English:** `code-simplicity-reviewer.md:51` tells the agent that `docs/plans` and `docs/solutions` are "created by `/ce:plan` and used by `/ce:work`" — the `ce:` prefix is upstream compound-engineering naming. In this repo the skills are `/plan` and `/work`.

**Problem:** Wrong skill names; pre-existing leftover from the port, surfaced while reviewing the neighborhood. Not introduced by this session's changes but in scope for a de-port pass.

**Fix:** Replace `/ce:plan` → `/plan` and `/ce:work` → `/work` on line 51.

**Effort:** Small

---

### P3-1: adversarial-reviewer §4 restates §2/§3

**Status:** `done`

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Read the section; partial-writes and reentrancy echo §2/§3 and data-integrity, but it's a judgment call whether the framing adds value.

**File(s):** `agents/review/adversarial-reviewer.md` (§4 State Corruption Under Adversity)

**Plain English:** The "§4 State Corruption Under Adversity" bullets (partial writes, reentrancy) largely repeat the race-condition and cascade material already in §2/§3, and overlap data-integrity-guardian.

**Problem:** Restated guidance lengthens the prompt without new instruction.

**Fix:** Fold the reentrancy bullet into §2 and drop §4, or cut §4 entirely once P2-1 scoping lands.

**Effort:** Small

---

### P3-2: Heading casing diverges between the two agent sub-families

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Direct comparison: bug-hunters use `## Core Analysis Framework`/`## Reporting` (Title Case); variants use `## Scan protocol`/`## Output` (sentence case).

**File(s):** all new `agents/review/*.md`

**Plain English:** The five bug-hunter agents use Title-Case section headings; the security/performance/language variants use sentence-case. Each sub-family is internally consistent, but the directory as a whole isn't.

**Problem:** Cosmetic inconsistency; no behavioral impact.

**Fix:** Pick one casing convention and apply across `agents/review/`. Low priority — only worth doing if touching the files anyway.

**Effort:** Small

---

### P3-3: lint retains Ruby in its toolchain-detection list

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Read `lint.md` detection list; Ruby (`standardrb`/`rubocop`, `erb_lint`) is present.

**File(s):** `agents/workflow/lint.md`

**Plain English:** `lint` was generalized to detect any project's linter, and the detect list includes Ruby. That's consistent with "language-agnostic," but this repo's stack is Python/TS, and Ruby was the original upstream-specific target.

**Problem:** Not a bug — the generalized agent legitimately supports Ruby. Flagged only so the Ruby line is a conscious keep, not a forgotten remnant.

**Fix:** Keep as-is (language-agnostic intent) or drop the Ruby row if you want the list to reflect only stacks you use. No action recommended unless you prefer the latter.

**Effort:** Small

---

## Verified clean

- All 12 new/changed `name:` frontmatter values exactly match their filenames.
- No `Kieran`/`Cora`/`Rails` language in any new file (the renamed reviewers are clean).
- security-sentinel-{python,typescript} stay structurally parallel; divergences (TS adds XSS + prototype-pollution; Python adds template-output) are real language differences, not drift.
- performance-oracle-{python,typescript} stay parallel; divergences (Python caching/hot-path; TS network/frontend) are justified.
- No stale agent references remain in `skills/`, `README.md`, or `CLAUDE.md` (verified by grep earlier this session).
