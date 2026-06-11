---
title: Review — /land reworked to pre-merge commit-onto-PR model
target: feat/land-skill (PR #32, uncommitted rework)
date: 2026-06-11
---

# Review — /land pre-merge rework

Scope: the model flip from post-merge stamping to pre-merge stamp + commit + push onto the open PR's branch. The new risk surface is Phase 5 (the skill now mutates git state — `commit` + `push` — which the prior version never did). Prose/registration changes (README, CLAUDE.md, install description, requirements doc) reviewed for consistency only.

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | 0 | — |
| P2 | 3 | 2 fixed, 1 wont-fix |
| P3 | 3 | 1 fixed, 2 wont-fix |
| **Total** | 6 | 3 fixed, 3 wont-fix |

### P2 Issues
- [x] **`git push origin HEAD` has no non-fast-forward handling** — Fixed: Phase 5 now pre-flights with `git fetch`, stops before committing if behind, no auto-rebase/force.
- [~] **No check for pre-existing unrelated edits in the target CLAUDE.md** — `wont-fix`.
- [x] **Commit happens before push can fail — order leaves a dangling local commit on failure** — Fixed: success message now conditional on push; failure path reports local-only state + recovery.

### P3 Issues
- [x] **`docs(<dir>)` commit scope can be noisy/invalid for root or deep dirs** — Fixed: scope uses leaf dir name (`land`, `root`).
- [~] **Body-prose refresh + single-file commit can silently drop intended edits** — `wont-fix`.
- [~] **Requirements doc R7 framing drift** — `wont-fix`.

---

## Groups

### G1: Commit/push failure handling is underspecified

**Issues:** P2-1, P2-3

**Why grouped:** Both are the same gap — the new git-mutation step (Phase 5 steps 20) has a happy-path-only spec. The commit-then-push ordering (P2-3) and the missing non-fast-forward branch (P2-1) are two faces of "what happens when push doesn't cleanly succeed."

**Suggested order:** P2-1 → P2-3

**Cascade:** Specifying the push-failure recovery (P2-1) largely resolves P2-3 — once you state "if push is rejected, tell the user the commit is local and how to sync," the dangling-commit ambiguity goes away. Fix P2-1 first.

---

## Issues

### P2-1: `git push origin HEAD` has no non-fast-forward handling

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Read Phase 5 step 20 — it issues `git push origin HEAD` with no mention of what to do if the remote rejects (non-fast-forward). The PR branch can advance independently (e.g. a suggestion committed via the GitHub UI, or a push from another machine), which is a realistic state for an open PR.

**File(s):** `skills/land/SKILL.md` (Phase 5, step 20)

**Plain English:** The skill commits the CLAUDE.md change locally and then runs `git push origin HEAD`. If the PR's branch on GitHub has moved ahead of your local copy (say you accepted a review suggestion in the web UI), Git refuses the push as "non-fast-forward" and the skill has no instruction for that case — you're left with a local commit and an error it didn't anticipate.

**Problem:** An open PR is exactly the kind of branch that drifts (UI commits, multi-machine work). Without a recovery path the skill dead-ends mid-operation, leaving a committed-but-unpushed stamp and an unclear next step.

**Fix:** In Phase 5, before pushing, fetch and check: `git fetch origin <headRefName>` then verify the local branch isn't behind. If the push is rejected, stop with a clear message: "Push rejected — the PR branch advanced on the remote. Run `git pull --rebase origin <branch>`, re-check the diff, then re-run /land or push manually." Do not auto-rebase or force-push.

**Effort:** Small

---

### P2-2: No check for pre-existing unrelated edits in the target CLAUDE.md

**Status:** `wont-fix`

**Category:** correctness

**Confidence:** medium

**Confidence rationale:** Phase 4/5 stage `<dir>/CLAUDE.md` and commit it; the spec never checks whether that file had unrelated modifications before /land touched it. Not traced against a live case, but the failure is structural.

**File(s):** `skills/land/SKILL.md` (Phase 4 steps 15-17; Phase 5 step 20)

**Plain English:** `/land` edits `<dir>/CLAUDE.md`, then `git add`s and commits exactly that file. If you happened to already have unrelated hand-edits in that same CLAUDE.md, they get folded into the "stamp PR context" commit without warning — the commit claims to be one thing but carries two.

**Problem:** Conflates unrelated work into a commit with a misleading message. Low-likelihood but silent, and it undercuts the clean-provenance goal of the skill.

**Fix:** In Phase 4, before editing, check `git status --short <dir>/CLAUDE.md`. If the file is already modified, surface it: "`<dir>/CLAUDE.md` has pre-existing uncommitted edits — they'll be included in the stamp commit. Continue / Cancel?" Let the user decide rather than silently bundling.

**Effort:** Small

---

### P2-3: Commit-then-push leaves a dangling local commit on push failure

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Read Phase 5 step 20: it commits, then pushes, then prints a success message ("pushed to PR #<N>"). The success message is unconditional in the spec — if the push step errors, the printed outcome and the actual state disagree.

**File(s):** `skills/land/SKILL.md` (Phase 5, step 20)

**Plain English:** The steps are: commit the file, push it, then say "Stamped and pushed to PR #N." There's no branch for "push failed," so on a failed push the skill could still report success while the commit sits only on your machine.

**Problem:** Misreported state. The user believes the doc rode the PR when it didn't, and merges without it — reintroducing the orphaned-doc problem this rework exists to solve.

**Fix:** Make the success message conditional on the push actually succeeding. If push fails, report: "Committed locally but push failed — the stamp is NOT on the PR yet." Tie this to the P2-1 recovery text.

**Effort:** Small

---

### P3-1: `docs(<dir>)` commit scope can be noisy or invalid for root/deep dirs

**Status:** `done`

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Phase 5 step 20's example message uses `docs(<dir>)`. For a root-level stamp the dir is `.` (→ `docs(.)`), and for nested dirs it's a path (→ `docs(skills/land)`), neither of which is a clean conventional-commit scope. Pattern-judged, not run.

**File(s):** `skills/land/SKILL.md` (Phase 5, step 20)

**Plain English:** The commit message template plugs the chosen directory into the conventional-commit scope, like `docs(skills): ...`. For the repo root that becomes `docs(.)` and for a nested path `docs(skills/land)` — awkward and inconsistent with how the repo's other commits scope things.

**Problem:** Cosmetic but it's the commit that lands on the PR, so it's visible. Inconsistent scopes clutter history.

**Fix:** Use the leaf directory name as the scope (e.g. `land` for `skills/land`, `root` or omit the scope for the repo root): `docs(<leaf>): stamp PR #<N> context into CLAUDE.md`.

**Effort:** Small

---

### P3-2: Body-prose edit and single-file commit scope aren't asserted to match

**Status:** `wont-fix`

**Category:** correctness

**Confidence:** low

**Confidence rationale:** Heuristic. Phase 4 step 17 ("refresh the body prose") operates on the same `<dir>/CLAUDE.md`, and Phase 5 stages only that file — so in practice they match. Flagging only because the spec never explicitly states the prose refresh must stay within the target file.

**File(s):** `skills/land/SKILL.md` (Phase 4 step 17; Phase 5 step 20)

**Plain English:** The skill refreshes prose in the target CLAUDE.md and then commits only that one file. They line up today, but nothing in the instructions says "only ever edit the target CLAUDE.md" — so a future tweak that edits a neighboring doc would silently not get committed.

**Problem:** Latent footgun, not a current bug.

**Fix:** Add a one-line invariant to Phase 4: "All edits in this run are confined to `<dir>/CLAUDE.md`; never modify other files." Makes the single-file commit provably complete.

**Effort:** Small

---

### P3-3: Requirements doc has minor framing drift after the rework

**Status:** `wont-fix`

**Category:** docs

**Confidence:** medium

**Confidence rationale:** R1/R2/R6/R7 were updated to the pre-merge model, but the surrounding doc (success criteria, scope boundaries referencing "uncommitted edits / one-step revert") may still read against the old model in spots. Skimmed, not line-audited.

**File(s):** `docs/brainstorms/2026-06-11-001-land-skill-requirements.md`

**Plain English:** The requirements doc's core requirements were rewritten for the new commit-onto-PR flow, but other sections (success criteria, scope boundaries) still carry phrasing from the original "lands as reviewable uncommitted edits, never commits" design.

**Problem:** Internal inconsistency in the product doc; a future reader gets mixed signals about whether /land commits.

**Fix:** Re-read the requirements doc end-to-end and align Success Criteria, Scope Boundaries, and Key Decisions with the pre-merge commit+push model (it now *does* commit and push, by design).

**Effort:** Small

---

## Notes

- No `cc-forge.local.md`; heavy reviewer panel (security/perf/migrations/agent-native) intentionally skipped. This is prompt authoring plus a one-line install string. The genuinely new surface is git mutation (commit/push), concentrated in Phase 5 — that's where the P2s sit.
- Net assessment: the rework is sound and directly fixes the orphaned-follow-up-PR problem. No P1s. The three P2s are all the same theme — the new push step needs a failure path and a pre-flight check — and are all Small. Worth fixing before merge since they affect a step that writes to the remote.
- Reminder for the author: last review I auto-applied fixes without asking. Not doing that here — these are written up for you to triage (or run `/review-walk`).
