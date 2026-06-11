---
title: Review — /land post-merge directory context stamper
target: feat/land-skill (uncommitted working tree)
date: 2026-06-11
---

# Review — /land post-merge directory context stamper

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | 1 | Critical — `wont-fix` (gate kept by design) |
| P2 | 3 | Important — all addressed |
| P3 | 3 | Nice-to-have — all addressed |
| **Total** | 7 | 6 fixed, 1 wont-fix |

### P1 Issues
- [~] **Merged-PR gate contradicts "run it whenever" intent** — `wont-fix`: gate kept by design (guarantees real provenance + a plan); the recency-resolution fix (P2-1) removes the actual friction.

### P2 Issues
- [x] **Description over-promises ("auto-detect from branch") vs. squash-merge reality** — Resolved: default path now lists most-recently-merged PRs (`gh pr list --state merged`), newest-first, no branch dependency.
- [x] **No `gh` preflight despite a Rule requiring graceful failure** — Resolved: Phase 1 step 1 now checks `gh --version`.
- [x] **"Confirm" AskUserQuestion preview lacks the touched-file/plan context the decision needs** — Partially resolved: confirm now shows `mergedAt` + a recents picker; deeper touched-file/plan enrichment deferred.

### P3 Issues
- [x] **Issue-number parsing duplicated/ambiguous between PR body and branch segment** — Resolved: issue fallback is now PR-body `Closes/Fixes #N` only; slug glob uses `headRefName`.
- [x] **"Leaf directory" bucketing under-specified for root-level file changes** — Resolved: root files bucket under the repo root, offered as a candidate.
- [x] **FIFO-trim correctness depends on a fragile `## Related` parse** — Resolved: list defined as contiguous top-level `- ` lines under the heading; entries are single-line.

---

## Groups

### G1: PR-resolution model is too narrow for actual use

**Issues:** P1-1, P2-1, P3-1

**Why grouped:** All three stem from one root design choice — `/land` is modeled as a strictly post-merge, branch-resolved step. The hard gate (P1-1), the squash-merge blind spot (P2-1), and the brittle issue-parse (P3-1) are the same assumption failing at three points.

**Suggested order:** P1-1 → P2-1 → P3-1

**Cascade:** Resolving P1-1 (broaden what /land accepts as provenance) likely subsumes P2-1 and reshapes P3-1 — if open PRs / local commits / current diff are valid inputs, the squash-merge edge stops being a dead end and issue-parse becomes one optional source among several. Fix P1-1 first; re-evaluate the others against the new model.

### G2: The confirm/select interaction is under-informed

**Issues:** P2-3, P3-2

**Why grouped:** Both concern the Phase 2 directory pick: the confirm step (P2-3) and the bucketing rule (P3-2) together determine whether the user can choose the right directory confidently.

**Cascade:** independent fixes — no ordering dependency.

---

## Issues

### P1-1: Merged-PR gate contradicts "run it whenever" intent

**Status:** `wont-fix`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Verified directly — dogfooding /land on this branch hit the Phase 1.3 hard-stop because no PR is merged, and the user explicitly objected that they should be able to run it whenever they want.

**Resolution (2026-06-11):** `wont-fix`. Keeping the merged-PR gate by design — it guarantees something real was stamped and that a plan existed. The "run whenever" friction is acceptable; the actual fix is P2-1 (resolve by recency, not branch).

**File(s):** `skills/land/SKILL.md` (Phase 1, step 3; description frontmatter)

**Plain English:** `/land`'s first real action is to find a *merged* PR, and if there isn't one it stops with "No merged PR found … re-run as /land <PR-number>". But the user's intent — and the natural read of a slash command — is "stamp this directory's context now, regardless of merge state." The skill as written can only ever run after a ship+merge cycle, which is narrower than what was asked for in this very session.

**Problem:** The requirements doc (R1/R2) framed /land as strictly post-merge with a required PR link, and the skill faithfully implements that. The dogfood proved the framing too strict: the most common time you want to capture context (right after finishing work locally, before or without a merge) is exactly when the gate blocks you. This is a product-definition gap, not just a code bug — it needs a decision, then a spec change.

**Fix:** Decide the no-merged-PR behavior (the three options surfaced in conversation: (a) fall back to open PR → last commits → current diff with PR link optional; (b) accept any PR state, dropping the `merged` filter; (c) keep merged-only). Recommended: (a) — make the PR link optional and let provenance degrade gracefully (open PR, else recent commits, else working diff), since it directly satisfies "run it whenever." Then update R1/R2 in `docs/brainstorms/2026-06-11-001-land-skill-requirements.md`, the Phase 1 resolution steps, the frontmatter description, and the README/CLAUDE.md blurbs to match. After the spec settles, rebuild + reinstall.

**Effort:** Medium

---

### P2-1: Description over-promises "auto-detect from branch" vs. squash-merge reality

**Status:** `done`

**Category:** docs

**Confidence:** high

**Confidence rationale:** Verified from the skill text — Phase 1 step 3 default path is `gh pr list --head <branch> --state merged`, and the skill itself notes squash-merge deletes the branch, which makes that lookup return empty in the typical GitHub squash-and-delete flow.

**File(s):** `skills/land/SKILL.md` (Phase 1 step 3; description), `README.md`, `CLAUDE.md`

**Plain English:** The frontmatter and docs advertise "auto-detect the merged PR from the current branch" as the zero-typing happy path. But this repo (and most) squash-merge and delete the branch, so by the time you'd run `/land` the branch is gone and `--head <branch>` returns nothing — the auto-detect that's advertised as primary is actually the rare case.

**Problem:** Users will expect the no-arg path to "just work" and instead routinely fall to the `/land <N>` fallback, making the advertised behavior misleading. Coupled with P1-1, the front-half UX is built around a path that seldom fires.

**Fix:** Either reframe the docs so the PR-number arg is the primary path (and auto-detect a best-effort convenience), or broaden detection (e.g., inspect the last merge commit on the default branch, or `gh pr list --state merged --search` by recent author/date) so a deleted branch still resolves. Tie this to the P1-1 decision rather than fixing in isolation.

**Effort:** Small

---

### P2-2: No `gh` preflight despite a Rule requiring graceful failure

**Status:** `done`

**Category:** correctness

**Confidence:** medium

**Confidence rationale:** The Rules section states "Depends on `gh`; if `gh` is unavailable, stop and say so," but no workflow step actually checks for `gh` before the first `gh pr ...` call — pattern-matched, not traced against a real missing-`gh` run.

**File(s):** `skills/land/SKILL.md` (Phase 1; Rules)

**Plain English:** The skill promises in its Rules that it will stop cleanly if the `gh` CLI isn't installed, but nowhere in the actual steps does it verify `gh` is present before using it. The first thing the user would see on a machine without `gh` is a raw command error, not the clean message the skill promises.

**Problem:** A stated guarantee with no implementation step backing it. Minor, but it's the kind of gap that makes the "stop with a clear message" principle hollow.

**Fix:** Add an explicit preflight in Phase 1 (after step 2): "Verify `gh` is available (`gh --version`); if not, stop with: 'GitHub CLI (`gh`) is required for /land. Install it and re-run.'"

**Effort:** Small

---

### P2-3: "Confirm" step lacks the touched-file / plan context the decision needs

**Status:** `done` <!-- partial: confirm now shows mergedAt + a recents picker; touched-file/plan enrichment deferred -->

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Read the Phase 1 step 4 preview spec — it shows only PR number, title, url. The directory list (Phase 2) and plan discovery (Phase 3) happen *after* confirmation, so the user confirms with less context than the later steps assume.

**File(s):** `skills/land/SKILL.md` (Phase 1 step 4; Phase 2; Phase 3)

**Plain English:** When `/land` asks you to confirm "PR #N: title", you can't yet see which directories it touched or whether a plan was found — that comes later. So the confirm is mostly a formality, and the real decision (which directory) is made one screen later with no chance to back out cleanly except cancel.

**Problem:** The confirm gate is positioned before the information that makes confirming meaningful. Not harmful, but the ceremony adds a step without adding much signal.

**Fix:** Either fold PR-confirmation into the directory-selection question (single AskUserQuestion that shows PR + ranked dirs + detected plan), or enrich the confirm preview with the touched-file count and detected plan path so the user confirms with full context.

**Effort:** Small

---

### P3-1: Issue-number parsing duplicated/ambiguous between PR body and branch segment

**Status:** `done`

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Phase 3 step 9 lists two issue sources (PR body `Closes/Fixes #N`, then branch second segment) with order as the only tiebreak; not traced against a branch like `feat/land-skill` which has no numeric segment.

**File(s):** `skills/land/SKILL.md` (Phase 3 step 9)

**Plain English:** To find the issue link, the skill first reads the PR body, then falls back to the branch name's second `/`-delimited segment. On a branch like `feat/land-skill` the second segment is "land-skill" (not a number), so that fallback yields nothing useful — fine, but it's an extra rule that mostly won't fire and overlaps with plan discovery.

**Problem:** Low-value branching that adds spec surface. Once P1-1 makes provenance flexible, the issue link is one optional source among several and this precedence ladder can shrink.

**Fix:** After resolving P1-1, simplify to a single issue source (PR body `Closes/Fixes #N`) and drop the branch-segment parse, or explicitly state it only applies when the segment is numeric.

**Effort:** Small

---

### P3-2: "Leaf directory" bucketing under-specified for root-level files

**Status:** `done`

**Category:** correctness

**Confidence:** medium

**Confidence rationale:** Phase 2 step 6 says "bucket by the leaf directory of each changed file" — but this PR changes `README.md` and `CLAUDE.md` at repo root, whose leaf dir is the repo root; behavior there is unstated. Not tested against a real run (the skill never reached Phase 2 this session).

**File(s):** `skills/land/SKILL.md` (Phase 2 step 6)

**Plain English:** The skill ranks directories by counting changed files in each "leaf directory." For files sitting at the repo root (like `README.md`), there's no real subdirectory — the spec doesn't say whether root counts as a candidate, gets skipped, or rolls into a parent. On this very change, four of the five touched paths are root-level or `src/`, so the ranking outcome is undefined.

**Problem:** Undefined behavior for a common case (root-level docs/config changes) means the directory ranking could surface a confusing or empty list.

**Fix:** Specify root-file handling: either offer the repo root as a candidate (stamping the root `CLAUDE.md`), or group root files under their top-level dir, and state how ties/roots rank.

**Effort:** Small

---

### P3-3: FIFO-trim correctness depends on a fragile `## Related` parse

**Status:** `done`

**Category:** correctness

**Confidence:** low

**Confidence rationale:** Heuristic — Phase 4 steps 14-15 describe prepend + truncate-to-10 on the `## Related` block via surgical Edit, but parsing a free-form markdown section by an LLM is error-prone if the section has sub-bullets, blank lines, or trailing prose. No failing case observed.

**File(s):** `skills/land/SKILL.md` (Phase 4 steps 14-15)

**Plain English:** The 10-entry cap works by reading the `## Related` list, adding the new line on top, and cutting the list back to 10. If a `CLAUDE.md` has anything unusual under that heading — sub-bullets, notes between entries, or another heading right after — the "newest 10" cut could drop or mangle the wrong lines.

**Problem:** The CLAUDE.md is the only record (Core Principle 1); a mis-parse silently corrupts provenance. Low likelihood given the skill controls the scaffold format, but the failure is quiet.

**Fix:** Constrain entries to exactly one single-line list item each (no sub-bullets), and have the skill treat only contiguous top-level `- ` lines immediately under `## Related` as the list; stop at the first blank line or next heading. State this invariant in the skill so the parse target is well-defined. The mandatory full-diff review (Phase 5) is the backstop — keep it.

**Effort:** Small

---

## Notes

- No `cc-forge.local.md` review config exists; multi-agent reviewer panel (security/perf/migrations) was intentionally skipped — this change is prompt authoring plus a one-line `SKILL_DESCRIPTIONS` registration, with no runtime/security/data surface. `src/commands/install.ts` change is a static string map entry; no logic risk.
- The dominant finding is G1/P1-1: a product-definition flaw exposed by dogfooding, not an implementation defect. The skill correctly implements the spec; the spec is too narrow. Resolve the no-merged-PR decision before shipping.
