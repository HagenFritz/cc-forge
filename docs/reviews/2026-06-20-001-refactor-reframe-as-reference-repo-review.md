---
title: "Review: Reframe cc-forge as a reference repo"
target: branch refactor/reframe-as-reference-repo
date: 2026-06-20
---

# Review: Reframe cc-forge as a reference repo

Reviewed the staged diff vs `main`: deletion of the npm/TS CLI apparatus (`src/`, `dist/`, `package*.json`, `tsconfig`, `tsdown.config.ts`, `.npmignore`) plus doc rewrites (`README.md`, `CLAUDE.md`, `skills/caveman/SKILL.md`, `.gitignore`). No code remains to review for security/perf/types — the review surface is documentation correctness: would a reader following these docs succeed?

No `cc-forge.local.md` present, so no configured agent fleet. Given the change is pure deletion + prose, ran a focused correctness pass directly rather than dispatching code-review agents that have no code to analyze. Verified every skill/agent name referenced in the new docs resolves to a real directory, the hook filename matches, and the documented JSON parses.

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | 0 | Critical — fix before merge |
| P2 | 2 | Important — should fix |
| P3 | 2 | Nice-to-have |
| **Total** | 4 | |

### P1 Issues
_None._

### P2 Issues
- [x] **Plugin marketplace one-liner won't work as written** — README documents `/plugin marketplace add HagenFritz/cc-forge`, but `marketplace.json` is named `cc-forge-local` with `source: "./"` (a local path), so the GitHub-fetch form won't resolve. **FIXED**: rewrote to use the local-clone path form.
- [x] **README claims a `/plugin install` path that the repo can't fully deliver** — presented as "load everything at once," overstating parity. **FIXED**: caveman-hook limitation folded into the headline sentence.

### P3 Issues
- [x] **Orphaned `~/.claude/.cc-forge-manifest.json` not mentioned in user-facing docs** — **FIXED**: added a "Migrating from the old CLI?" note with cleanup command.
- [ ] **`docs/` is fully gitignored, so the new `## Related` plan link resolves to a local-only file** — **WONT-FIX**: intentional convention, identical to the existing PR #32 entry. Left as-is per review recommendation.

---

## Groups

### G1: Plugin-path overpromise

**Issues:** P2-1, P2-2

**Why grouped:** Both stem from the same root cause — the README presents `.claude-plugin/` as a working "install everything" route, but the marketplace metadata wasn't updated to support a remote `add`, and the path's limitations are undersold.

**Suggested order:** P2-1 → P2-2

**Cascade:** Fixing P2-1 (make the marketplace entry actually resolvable, or downgrade the instruction to the local-clone form) determines how P2-2 should be worded. If you decide the plugin path isn't worth supporting, both collapse into "delete the plugin section from README" and `.claude-plugin/` stays as dormant metadata.

---

## Issues

### P2-1: Plugin marketplace one-liner won't work as written

**Status:** `done`

**Category:** docs

**Confidence:** high

**Confidence rationale:** Read `.claude-plugin/marketplace.json` directly: `name` is `cc-forge-local`, `source` is `"./"`. Confirmed the README instruction against it.

**File(s):** `README.md` (lines 37-38, "Optional — install the whole set as a plugin"), `.claude-plugin/marketplace.json`

**Plain English:** The README tells people to run `/plugin marketplace add HagenFritz/cc-forge`, but the marketplace file at `.claude-plugin/marketplace.json` is named `cc-forge-local` and points its source at `"./"` — a local folder path. A `HagenFritz/cc-forge` GitHub add either won't find a marketplace by that name or won't resolve a `./` source remotely, so the documented one-liner likely fails for anyone who isn't already cloned locally.

**Problem:** A reader copy-pasting the plugin command hits a failure, which is exactly the "screwed up install" class of problem this whole refactor set out to remove. Documenting an install path that doesn't work reintroduces the contradiction.

**Fix:** Pick one: (a) update `marketplace.json` so a remote add works — give it a public-facing name and a source that resolves from the GitHub repo (verify what Claude Code's plugin loader accepts for a repo-root marketplace), then keep the README instruction; or (b) downgrade the README instruction to the locally-cloned form (`/plugin marketplace add /path/to/cloned/cc-forge`) and state plainly it's for a local clone, not a remote fetch. Option (b) is lower-effort and matches the "reference repo you clone" framing. Whichever path, the README command and `marketplace.json` must agree.

**Effort:** Small

---

### P2-2: README oversells the plugin path as full-parity "install everything"

**Status:** `done`

**Category:** docs

**Confidence:** medium

**Confidence rationale:** The README does correctly note the plugin path skips the caveman hook; the concern is emphasis/framing, not a factual error. Not verified against how a real user reads it.

**File(s):** `README.md` ("Optional — install the whole set as a plugin" subsection)

**Plain English:** The README presents the `/plugin install` route as loading "everything at once," then adds that it doesn't wire the caveman hook. A reader skimming for the fastest install may take the plugin path expecting full parity and be surprised caveman silently doesn't persist.

**Problem:** Minor expectation mismatch. Not a breakage, but it undercuts the doc's job of setting accurate expectations — the same clarity goal driving the refactor.

**Fix:** Tighten the wording so the limitation is part of the headline, not a footnote — e.g. "loads all skills and agents (but not the caveman hook — that's always manual)." If P2-1 is resolved by dropping the remote instruction, fold this into the same edit.

**Effort:** Small

---

### P3-1: No user-facing pointer to clean up the orphaned manifest

**Status:** `done`

**Category:** docs

**Confidence:** high

**Confidence rationale:** Confirmed nothing in the repo reads `~/.claude/.cc-forge-manifest.json` after the CLI deletion (grepped skills/agents). The cleanup note exists only in the plan's Operational Notes, not in README or CLAUDE.md.

**File(s):** `README.md`, `CLAUDE.md`

**Plain English:** Anyone who previously ran the old CLI installer has a `~/.claude/.cc-forge-manifest.json` file that nothing reads anymore. The refactor leaves it orphaned, and neither README nor CLAUDE.md tells them they can delete it.

**Problem:** Cosmetic leftover on existing users' machines. Harmless, but a one-line note closes the loop and prevents "what is this stale file" confusion later.

**Fix:** Add a one-line note in the README's caveman/removal area (or a short "Migrating from the old CLI" aside): "If you previously used the cc-forge CLI installer, you can delete `~/.claude/.cc-forge-manifest.json` — nothing reads it anymore." Optional given the audience is essentially you.

**Effort:** Small

---

### P3-2: `## Related` plan link is dead for fresh clones (docs/ gitignored)

**Status:** `wont-fix`

**Category:** docs

**Confidence:** high

**Confidence rationale:** Verified `.gitignore` ignores `docs/plans/`, `docs/brainstorms/`, `docs/initiatives/`; the new CLAUDE.md `## Related` entry links `docs/plans/2026-06-20-001-...-plan.md`, which is not tracked. The pre-existing PR #32 entry has the identical property.

**File(s):** `CLAUDE.md` (`## Related` section), `.gitignore`

**Plain English:** The new provenance entry in `CLAUDE.md` links to a plan file under `docs/plans/`, but `.gitignore` excludes that whole directory — so the link works on your machine but 404s for anyone who clones the repo. This is the same situation as the existing PR #32 link, so it's a pre-existing convention, not a regression.

**Problem:** Broken internal link for readers of the repo. Low impact — the `## Related` section is primarily a local provenance trail (the `/land` convention), and the entry text is self-describing even without the link resolving.

**Fix:** No action required if the gitignored-plans convention is intentional (it appears to be — `/land` stamps these deliberately). If you want the links to resolve for others, either un-ignore `docs/plans/` or drop the `[plan](...)` link and keep the prose summary. Recommend leaving as-is for consistency with the existing entry.

**Effort:** Small

---

## Notes (non-findings, verified clean)

- Every skill referenced in the new README (`/plan`, `/brainstorm`, … `/caveman`) resolves to a real `skills/<name>/` directory. No dangling references.
- All four agent categories (`research`, `review`, `workflow`, `test`) exist; README and CLAUDE.md now both list `test/` (previously omitted).
- Hook filename in README setup steps (`cc-forge-caveman-mode-tracker.cjs`) matches the actual file in `hooks/`.
- The caveman hook `.cjs` is byte-for-byte unchanged (verbatim, per plan R3).
- The README's settings.json fallback JSON is structurally valid and matches the real installed hook block.
- `skills/caveman/SKILL.md` no longer references any deleted CLI command; flag-file + hook mechanics preserved.
