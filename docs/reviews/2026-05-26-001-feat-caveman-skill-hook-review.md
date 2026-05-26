---
title: "Review: feat/28/caveman-skill-hook"
target: branch feat/28/caveman-skill-hook (uncommitted)
date: 2026-05-26
---

# Review: feat/28/caveman-skill-hook

Multi-agent review of the uncommitted diff implementing the `/caveman` skill, `UserPromptSubmit` hook, manifest-driven settings.json ownership, and `--dry-run` install/uninstall. Plan at `docs/plans/2026-05-22-001-feat-caveman-skill-and-persistence-hook-plan.md`.

Agents run: kieran-typescript-reviewer, security-sentinel, pattern-recognition-specialist, architecture-strategist, code-simplicity-reviewer, compound-engineering:review:agent-native-reviewer, learnings-researcher (no past learnings exist).

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | 1 | Critical — fix before merge |
| P2 | 11 | Important — should fix |
| P3 | 12 | Nice-to-have |
| **Total** | 24 | |

### P1 Issues
- [ ] **Stale skill list in install outro** — `/git-worktree`, `/frontend-design`, `/create-initiative` listed but no longer exist in `skills/`

### P2 Issues
- [ ] **Symlink redirect of `.cc-forge-tmp` temp paths** — manifest + settings.json writes don't use O_NOFOLLOW the way the hook does
- [ ] **Manifest corruption silently treated as empty entries** — opens duplicate-hook-entry path; violates plan's "distinguish corrupted from missing"
- [ ] **`commitAddHookEntry` mutates plan after returning** — confusing dual-purpose return shape; `entry: null` for idempotent case forces awkward callers
- [ ] **Two-store atomicity gap between settings.json and manifest** — if `manifest.addEntry` throws after settings.json write succeeds, ownership invariant breaks
- [ ] **Uninstall with parse error wedges state** — deletes manifest + hook file even when settings.json couldn't be cleaned, losing UUID record
- [ ] **Spinner-then-confirm-then-spinner choreography in `wireCavemanHook`** — fights clack's UX; SIGINT mid-confirm leaks spinner state
- [ ] **Doctor has no `--json` output and never exits non-zero** — agents can't reliably consume doctor output
- [ ] **settings.json write loses existing mode/ownership** — replaces inode with 0o600 even if user set 0o644 deliberately; no fsync before rename
- [ ] **`flagFilePath`/`deleteFlagFile` mixed into generic `src/claude.ts`** — caveman-specific helpers leak into the "generic ~/.claude copier" module
- [ ] **`wireCavemanHook` not abstracted** — second cc-forge hook would duplicate the entire confirm/spinner/dry-run orchestration
- [ ] **Doctor's hierarchical reporting slides back to flat-list** — failures don't short-circuit; 1 root cause can emit 5 warnings

### P3 Issues
- [ ] **Stale `entries()` returns mutable internal reference** — leaky abstraction in `manifest.ts`
- [ ] **`RemovePlan.found` field is cosmetic only** — no consumer materially uses it
- [ ] **`parseIntent` matches "caveman" anywhere in prompt** — pasted text containing "caveman" + trigger word toggles mode
- [ ] **`--yes` flag silently accepted but unused by uninstall** — contract drift between CLI and command
- [ ] **Caveman flag-file contract undocumented for direct writers** — agents can write the flag but the schema lives only in source
- [ ] **Manifest schema undocumented** — README mentions the file exists but not its shape
- [ ] **`HOOK_PREFIX` not exported** — literal `cc-forge-caveman-mode-tracker.cjs` duplicated across 3 files
- [ ] **`JSON.parse` cast to `SettingsShape` without null/array guard** — `null` or `[]` settings.json would NPE downstream
- [ ] **`packageRoot()` duplicated across install + uninstall** — same 3 lines in two files
- [ ] **`CLAUDE_DIR` not centralized** — 4 files independently re-derive `path.join(os.homedir(), '.claude', ...)`
- [ ] **Doctor revalidates flag-file with stricter checks than hook** — duplicates the hook's whitelist/symlink/size logic; redundant once hook is trusted
- [ ] **Doctor's settings.local.json overlay check is speculative** — no cc-forge code path creates the conflict it warns about

---

## Groups

### G1: Manifest data-integrity cluster

**Issues:** P2-2 (silent corruption), P2-3 (commitAddHookEntry API), P2-4 (two-store atomicity), P2-5 (uninstall parse-error wedge)

**Why grouped:** All four describe the same architectural seam — the manifest as canonical ownership record. P2-2 lets a corrupt manifest masquerade as "empty," P2-3 leaks an internal idempotency-vs-outcome distinction into the API, P2-4 lets settings.json drift ahead of the manifest on partial failure, and P2-5 deletes the manifest even when settings.json couldn't be reconciled. Together they describe a fragile invariant: "the manifest tells the truth about what cc-forge owns."

**Suggested order:** P2-2 → P2-4 → P2-5 → P2-3 (fix detection of corruption first, then two-store atomicity, then uninstall behavior, then API shape last because it's mostly cosmetic now that the underlying semantics are correct).

**Cascade:** Fixing P2-2 (surface manifest parse errors) is a precondition for P2-5 (uninstall behavior on parse error) — without explicit error surfacing, uninstall can't distinguish "manifest empty" from "manifest unreadable." P2-4's compensating rollback is independent and can land in parallel.

---

### G2: Filesystem-write hardening cluster

**Issues:** P2-1 (symlink redirect of temp paths), P2-8 (settings.json mode/ownership/fsync)

**Why grouped:** Both are about the atomic-write primitives in `manifest.ts:39` and `settings-patcher.ts:51`. The hook uses O_NOFOLLOW + lstat checks; the TS-side writes don't. Same fix shape touches both files.

**Suggested order:** P2-1 → P2-8 (fix the symlink hole first; mode preservation can ride on the same write helper).

**Cascade:** Sharing the implementation: extract a `safeAtomicWrite(targetPath, content)` helper into `src/claude.ts` (or a new `src/safe-fs.ts`) that mirrors the hook's `safeWriteFlag` discipline. Both call sites consume it.

---

### G3: Install/uninstall UX + agent-native cluster

**Issues:** P1-1 (stale outro), P2-6 (spinner choreography), P2-7 (no JSON doctor), P3-4 (--yes silently ignored), P3-5 (flag-file contract undoc), P3-6 (manifest schema undoc)

**Why grouped:** All surface the same gap — the install/uninstall/doctor commands work for humans-in-a-terminal but are weak for agents and rough on accuracy. The stale outro is the canonical "humans don't trust the output" symptom; the rest are agent-parity gaps.

**Suggested order:** P1-1 (obvious bug, fix immediately) → P2-7 (doctor --json + exit code; biggest agent-parity win) → P3-4 (--yes contract) → P3-5/P3-6 (docs) → P2-6 (spinner; UX polish, lowest user-visible impact).

**Cascade:** P1-1 + P2-6 are both install.ts touches. P2-7 changes doctor.ts. P3-5 and P3-6 are README/SKILL.md doc adds. No fix dependency between them, but bundle into one commit since they share scope.

---

### G4: Architectural cleanup cluster

**Issues:** P2-9 (claude.ts mixed concerns), P2-10 (wireCavemanHook not abstracted), P2-11 (doctor hierarchy flat)

**Why grouped:** All three describe the same pressure — the implementation works for one hook but second-hook readiness, which was the explicit reason to "abstract now" per the plan, isn't quite there. Module boundary leakage (P2-9), per-hook install orchestration not extracted (P2-10), and doctor's reporting that should be hierarchical per the plan but accumulates booleans instead (P2-11).

**Suggested order:** P2-10 → P2-9 → P2-11. Extracting `wireHook(cfg, opts)` first sets the precedent; moving caveman-state helpers out of claude.ts is a small follow-on; doctor hierarchy is cosmetic but documents the precondition graph.

**Cascade:** P2-10's `wireHook` helper sets the shape; P2-9 then has a clear home for caveman-specific helpers (likely `src/caveman.ts` or fold into settings-patcher). P2-11 is independent.

---

### G5: Simplicity / dead-code cluster

**Issues:** P3-1 (mutable entries), P3-2 (RemovePlan.found), P3-11 (doctor flag revalidation), P3-12 (settings.local overlay speculation), P3-7 (HOOK_PREFIX), P3-9 (packageRoot), P3-10 (CLAUDE_DIR), P3-8 (parse null/array guard)

**Why grouped:** Subtractive edits + duplication cleanup. Each one is small but they share the same problem: "the first-hook implementation is a few exports / branches richer than it needs to be." A single cleanup pass collapses ~50–70 LOC.

**Suggested order:** Bundle into one commit; no ordering dependency.

**Cascade:** independent fixes — no ordering dependency.

---

## Issues

### P1-1: Stale skill list in install outro

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Three independent reviewers flagged it; verified — commit `9bd5a50` removed these skills but the outro still lists them.

**File(s):** `src/commands/install.ts:100-105`

**Plain English:** The install command's success message tells the user `/git-worktree`, `/frontend-design`, and `/create-initiative` were installed — but those skills were removed from the repo in commit `9bd5a50` and don't ship anymore. New users will type those commands and they won't exist.

**Problem:** The outro lies about what got installed. It will mislead every new user. Worse, the same pattern was in the old install.ts before the rewrite — the rewrite preserved the brittle hardcoded list verbatim instead of sourcing the list from `copied` (the array `copySkills` already returns).

**Fix:** Either (a) delete the three stale lines as a minimum fix, or (b) build the outro list from the `copied` array returned by `copySkills` plus a `description` map keyed by skill name. Option (b) prevents this exact drift from recurring.

**Effort:** Small

---

### P2-1: Symlink redirect of `.cc-forge-tmp` temp paths

**Status:** `done`

**Category:** security

**Confidence:** high

**Confidence rationale:** Verified the code paths — `fs.writeFileSync` on the tmp paths follows symlinks, unlike the hook's `safeWriteFlag` which uses O_NOFOLLOW.

**File(s):** `src/manifest.ts:35-41`, `src/settings-patcher.ts:51-57`

**Plain English:** The hook (`hooks/cc-forge-caveman-mode-tracker.cjs:44-55`) uses `O_NOFOLLOW` and `O_EXCL` when writing the flag file so an attacker can't pre-create a symlink at the target. The manifest and settings.json writers do `fs.writeFileSync(tmp, ...)` first, then rename — but the tmp paths (`${MANIFEST_PATH}.cc-forge-tmp` and `${SETTINGS_PATH}.cc-forge-tmp`) are predictable and `fs.writeFileSync` happily follows symlinks. Pre-planting a symlink at the tmp path redirects the write.

**Problem:** This breaks the symmetry the plan called out. The hook is hardened against this exact pattern because the flag-file path is predictable; the manifest and settings.json paths are equally predictable. cc-forge's single-user threat model accepts "$HOME write = game over" but a cross-user (shared dev box, CI sandbox) attacker with only predictable-path-write capability can use this to escalate before lockdown.

**Fix:** Replace `fs.writeFileSync(tmp, ..., { mode: 0o600 })` with the same `openSync(tmp, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW, 0o600)` + `writeSync` + `closeSync` + `renameSync` pattern used in `safeWriteFlag` (hooks/cc-forge-caveman-mode-tracker.cjs:44-55). Use `process.pid` + `Date.now()` in the tmp name so it isn't a fixed target. Best implemented as a shared `safeAtomicWrite()` helper used by both `manifest.ts` and `settings-patcher.ts`.

**Effort:** Small

---

### P2-2: Manifest corruption silently treated as empty entries

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Read `readManifestRaw` directly — catch-all returns `{ version: 1, entries: [] }` on any error. Verified doctor consumes via `findEntry` without distinguishing the case.

**File(s):** `src/manifest.ts:22-33`, `src/commands/doctor.ts:68`

**Plain English:** If `~/.claude/.cc-forge-manifest.json` is corrupted (truncated, hand-edited badly, unparseable), `readManifestRaw` swallows the error and returns an empty manifest. The next `cc-forge install` then thinks no caveman entry exists, appends a *second* entry to settings.json, and the duplicate fires on every prompt — and the original entry is now orphaned because its UUID is gone.

**Problem:** The plan (line 463) explicitly required distinguishing `corrupted` from `present but missing entry`. The current code conflates them. This is also the inverse of how settings.json is handled — `SettingsParseError` surfaces clearly and refuses to clobber. The manifest, which is supposed to be the canonical ownership record, silently loses data.

**Fix:** Mirror the `SettingsParseError` pattern. Throw on JSON parse failure in `readManifestRaw`; catch at install/uninstall entry points and surface a clear remediation: "manifest at `~/.claude/.cc-forge-manifest.json` is unparseable; verify it doesn't contain entries you need, then remove it and re-run `cc-forge install`." Add a `readManifestSafe(): Manifest | { error: string }` so doctor can report `corrupted` distinctly from `missing entry`.

**Effort:** Small

---

### P2-3: `commitAddHookEntry` mutates plan after returning

**Status:** `done`

**Category:** architecture

**Confidence:** high

**Confidence rationale:** Verified by reading `src/settings-patcher.ts:100-128` — the plan object is mutated post-write (`plan.uuid = entry.uuid`) and the same plan reference is returned to the caller.

**File(s):** `src/settings-patcher.ts:100-128`, `src/commands/install.ts:158,163`

**Plain English:** `commitAddHookEntry` computes a plan (which has `uuid?: undefined` if no entry exists yet), writes the entry, then mutates `plan.uuid = entry.uuid` and returns both the plan and the entry. Callers have to distinguish "newly written" from "already wired" via the awkward expression `entry ? ... : 'Already wired'` (install.ts:158,163). The plan object is now doing double-duty as both intent and outcome.

**Problem:** Plans should describe intent, not carry outcome. The post-commit mutation makes the API surface confusing and the `entry: null` for "already present" forces every caller into a ternary. Future call sites are likely to misuse this.

**Fix:** Drop `uuid?` from `AddPlan` entirely — it's an outcome, not a plan field. Have `commitAddHookEntry` return `{ alreadyPresent: boolean; entry: ManifestEntry }` (always return an entry — look it up via `manifest.findEntry` in the already-present branch). Callers then write `result.alreadyPresent ? 'Already wired' : \`Wired (uuid=${result.entry.uuid.slice(0,8)}…)\``.

**Effort:** Small

---

### P2-4: Two-store atomicity gap between settings.json and manifest

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Verified by reading the sequence in `commitAddHookEntry` and `commitRemoveHookEntry` — there's no compensating action if the second write fails.

**File(s):** `src/settings-patcher.ts:100-129, 152-180`

**Plain English:** `commitAddHookEntry` does `writeSettingsAtomic(settings)` then `manifest.addEntry(...)`. If the manifest write fails (disk full, permission flip, EIO), settings.json now has a hook entry that the manifest doesn't own. Doctor will report a "wiring discrepancy"; uninstall will leave the orphaned settings entry alone because the manifest doesn't know about it. The exact problem the manifest exists to prevent.

**Problem:** The plan called the manifest the "canonical ownership record." But the implementation can land in a state where settings.json knows about an entry the manifest doesn't, with no compensating action. Same shape applies to remove (settings filtered, then manifest entry deletion fails → manifest references a phantom entry).

**Fix:** Wrap the sequence in try/catch. On failure of the second write, revert the first: re-write settings.json without the entry (we still have the pre-mutation copy in scope), then surface the error. For remove, the inverse: re-add to settings.json if manifest cleanup fails.

**Effort:** Medium

---

### P2-5: Uninstall + parse error wedges state

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Verified by reading `src/commands/uninstall.ts:58-104` — the catch logs the error but continues to delete the manifest, leaving the user with no recovery handle.

**File(s):** `src/commands/uninstall.ts:58-104`

**Plain English:** If `cc-forge uninstall` runs while `~/.claude/settings.json` has a parse error, `commitRemoveHookEntry` throws (rightly). The catch at line 65 logs the error but the code continues — it deletes the hook file, deletes the manifest, and deletes the flag file. Now the user has: a settings.json that still references a now-deleted hook, no manifest to identify the UUID, and no record of what cc-forge owned. Their only recovery is hand-editing settings.json.

**Problem:** The manifest exists to make uninstall safe. By deleting it before the settings.json cleanup completes, uninstall destroys its own recovery surface.

**Fix:** On `SettingsParseError` during uninstall, do NOT delete the manifest. Surface: "could not clean settings.json (parse error). The manifest at ~/.claude/.cc-forge-manifest.json is preserved so you can re-run `cc-forge uninstall` after fixing settings.json." The filesystem cleanup (hook file, flag file) can still proceed since those are cc-forge-owned.

**Effort:** Small

---

### P2-6: Spinner-then-confirm-then-spinner in `wireCavemanHook`

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Traced the control flow — TTY path uses a different spinner lifecycle than non-TTY, both can leak on SIGINT.

**File(s):** `src/commands/install.ts:143-160`

**Plain English:** When the install runs interactively (TTY + not `--yes`), the code starts a spinner labeled "Wiring...", stops it with "Confirming hook installation...", calls `confirm()`, and on accept starts a *new* spinner. If the user hits SIGINT during the confirm, neither spinner is guaranteed clean. The visual flow is also confusing — the first spinner finishes with a "confirming" message that then immediately becomes a prompt.

**Problem:** The pattern fights clack's design. Spinners and confirms should be cleanly separated, not interleaved.

**Fix:** Stop `s` before any interactive prompt. Run `confirm()` outside spinner scope. Start a fresh spinner only after the user confirms. Or: don't start `s` at all until after the confirm.

**Effort:** Small

---

### P2-7: Doctor has no `--json` output and never exits non-zero

**Status:** `done`

**Category:** architecture

**Confidence:** high

**Confidence rationale:** Verified — `doctor.ts:42` returns even when `allGood` is false; no `process.exit(1)`. All output is via `@clack/prompts` styled functions.

**File(s):** `src/commands/doctor.ts:16-46`

**Plain English:** `cc-forge doctor` prints styled human output with ANSI colors and box-drawing characters. An agent that wants to verify "is caveman wired and active?" has to scrape ANSI-decorated strings. The function also returns normally even when checks fail, so `cc-forge doctor && echo ok` always echoes ok.

**Problem:** Doctor is the canonical inspection surface, and it's invisible to agents. cc-forge's design philosophy emphasizes agent-native parity; this is the largest single parity gap.

**Fix:** Add `--json` flag that prints a single JSON object: `{ ok: boolean, checks: [{name, status, detail}], caveman: { hookFile, manifestEntry, settingsWired, mode, localOverlayConflict } }`. Also `process.exit(allGood ? 0 : 1)` so `cc-forge doctor` is usable in `&&` chains.

**Effort:** Small

---

### P2-8: settings.json write loses mode/ownership; no fsync

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Read the write path; `fs.writeFileSync` with hardcoded mode + no fsync.

**File(s):** `src/settings-patcher.ts:51-57`, `src/manifest.ts:35-41`

**Plain English:** When settings.json already exists, the user may have set it to 0644 to let another tool read it. The atomic temp+rename replaces the inode with a 0600 file, silently breaking that. There's also no `fs.fsyncSync(fd)` before rename, so a crash mid-write can yield a zero-byte file and lose the user's settings.

**Problem:** Silent permission tightening + no durability barrier. The mode hardcoded to 0o600 is opinionated — fine for the manifest, less obvious for settings.json which is the user's file.

**Fix:** Before writing, `fs.statSync(SETTINGS_PATH)` to capture existing mode if the file is present; apply that mode to the temp file. Add `fs.fsyncSync(fd)` after write and before rename. Manifest mode can stay 0o600 (cc-forge-owned).

**Effort:** Small

---

### P2-9: `flagFilePath` / `deleteFlagFile` mixed into generic `src/claude.ts`

**Status:** `done`

**Category:** architecture

**Confidence:** medium

**Confidence rationale:** Reasonable judgment call; flagged by two reviewers because the user explicitly considers `src/claude.ts:5-105` clean.

**File(s):** `src/claude.ts:139-153`

**Plain English:** `src/claude.ts` was originally a generic file-copy module ("cc-forge writes/reads things under ~/.claude/"). `flagFilePath()` and `deleteFlagFile()` are caveman-specific runtime state helpers — they don't fit the module's abstraction. The moment a second cc-forge hook lands with its own state file, this becomes awkward.

**Problem:** Module boundary leak. `hookPath()` is generic and fits; `HOOK_PREFIX`/`HOOKS_DIR` are generic and fit. The two flag-file helpers are the odd ones.

**Fix:** Move `flagFilePath` and `deleteFlagFile` into a new tiny `src/caveman.ts` (or inline into `uninstall.ts` since they're used in exactly one place — 5 lines). Keeps `src/claude.ts` as the generic filesystem layer.

**Effort:** Small

---

### P2-10: `wireCavemanHook` not abstracted — second hook would duplicate

**Status:** `wont-fix`
**Skip reason:** Premature for one-hook ship. Revisit when a second cc-forge hook lands.

**Category:** architecture

**Confidence:** medium

**Confidence rationale:** Verified that the install orchestration (spinner + dry-run + confirm + commit + error message shape) is inline in `install.ts`, not factored out of `SettingsPatcher`.

**File(s):** `src/commands/install.ts:117-172`

**Plain English:** The plan called for `SettingsPatcher` to be "the abstraction now" so a second hook is trivial. The plan/commit split lives in `settings-patcher.ts`, but the install-time orchestration (spinner UX, dry-run text rendering, first-time confirm) is hardcoded inline in `wireCavemanHook`. Adding a second hook means duplicating this whole function.

**Problem:** The abstraction stops at `commitAddHookEntry`. Everything from "user-friendly spinner output" up to "first-time consent prompt" is per-call.

**Fix:** Extract a `wireHook(cfg, opts, { description, dryRunDetail })` helper either in `settings-patcher.ts` or a small `src/wire-hook.ts`. `wireCavemanHook` becomes a one-liner config + call. Second hook is then genuinely a config-only addition.

**Effort:** Medium

---

### P2-11: Doctor's hierarchical reporting slides back to flat-list

**Status:** `done`

**Category:** architecture

**Confidence:** medium

**Confidence rationale:** Verified — `checkCaveman` does sequential `log.warn/success` calls and accumulates `ok`; failures don't short-circuit dependent checks.

**File(s):** `src/commands/doctor.ts:43-145`

**Plain English:** The plan called for hierarchical checks where settings.json wiring gates flag-file meaning. The code does check `wired` before pronouncing "active" — good. But the section runs all 5 checks sequentially regardless of failures, so a missing hook file emits 5 separate warnings about 5 different missing things, when the root cause is "you haven't installed yet."

**Problem:** A user reading 5 warnings has to figure out the dependency graph themselves. The plan asked for actual hierarchy.

**Fix:** Short-circuit on root failures. If the hook file is missing, report only that and return (the rest is implied). If the manifest is missing, report only that. Only descend into wiring/flag checks once preconditions hold.

**Effort:** Small

---

### P3-1: `entries()` returns mutable internal reference

**Status:** `done`

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Verified by reading the function; returns `m.entries` directly without copy.

**File(s):** `src/manifest.ts:47-49`

**Plain English:** `entries()` returns the internal array from the parsed JSON object. A caller that mutates it would silently corrupt state on the next read.

**Problem:** Leaky abstraction. The function name suggests a snapshot but returns a live reference.

**Fix:** Return `[...m.entries]` (defensive copy). Trivial change.

**Effort:** Small

---

### P3-2: `RemovePlan.found` field is cosmetic

**Status:** `done`

**Category:** maintainability

**Confidence:** high

**Confidence rationale:** Traced consumers — `found` is only used to print "found in settings.json: true/false" in dry-run output.

**File(s):** `src/settings-patcher.ts:131-151`, `src/commands/uninstall.ts:50-53`

**Plain English:** `planRemoveHookEntry` reads settings.json just to compute a `found` field that's only used as a dry-run cosmetic. `commitRemoveHookEntry` re-reads and re-filters anyway.

**Problem:** Dead computation, ~15 LOC.

**Fix:** Drop `found` from `RemovePlan`. Drop the try/catch at lines 135-142. The filter at 160-165 already handles "not present" as a no-op.

**Effort:** Small

---

### P3-3: `parseIntent` matches "caveman" anywhere in prompt

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Verified the regex patterns — they match anywhere in the full lowercased prompt.

**File(s):** `hooks/cc-forge-caveman-mode-tracker.cjs:99-125`

**Plain English:** A sentence like *"I want to write a blog post about how to enable caveman diets"* matches the activation regex and flips the mode on. Inverse for deactivation phrases. The slash form is unambiguous; natural-language matching on the full prompt is too greedy.

**Problem:** Not a classical exploit, but a false-positive surface. Pasted text, file contents, MCP tool output that gets re-prompted can flip persistent state.

**Fix:** Anchor natural-language patterns to the start of the prompt (`^\s*(please\s+)?(activate|enable|...)\b.*\bcaveman\b`) or only match in the first ~50 chars. The slash form (`/caveman`) keeps full coverage for explicit activation.

**Effort:** Small

---

### P3-4: `--yes` flag silently ignored by uninstall

**Status:** `done`

**Category:** architecture

**Confidence:** high

**Confidence rationale:** Verified — `cli.ts:7-9` parses `--yes`, passes it to `runUninstall`, but `UninstallOptions` doesn't include it.

**File(s):** `src/cli.ts:7-9, 30-33`, `src/commands/uninstall.ts:21-25`

**Plain English:** Help text advertises `--yes` generically. Uninstall accepts the flag but ignores it. Today there are no prompts, so the silent ignore is harmless — but if prompts are added later, behavior diverges from the documented contract.

**Problem:** Contract drift.

**Fix:** Either thread `opts.yes` into `UninstallOptions` for future use, or restrict `--yes` to `install` only and update the help text.

**Effort:** Small

---

### P3-5: Caveman flag-file contract undocumented

**Status:** `done`

**Category:** docs

**Confidence:** high

**Confidence rationale:** Searched README and SKILL.md — only the file path is mentioned, not the schema.

**File(s):** `skills/caveman/SKILL.md:17`, `README.md`

**Plain English:** An agent can toggle caveman by writing `~/.claude/.caveman-active` directly (the hook validates content). But nothing tells the agent this is supported — the contract lives only in hook source. Agents end up parsing slash commands through chat to do something a one-line write would do.

**Problem:** Action parity is technically present but undiscoverable.

**Fix:** Add a "Programmatic control" section to `skills/caveman/SKILL.md` (and an "Agent Interface" block to README): write `lite|full|ultra` to `~/.claude/.caveman-active` to enable; `rm` to disable; content must be trimmed-lowercase, file must not be a symlink, max 64 bytes.

**Effort:** Small

---

### P3-6: Manifest schema undocumented

**Status:** `done`

**Category:** docs

**Confidence:** high

**Confidence rationale:** README mentions the file's purpose; doesn't document its shape.

**File(s):** `README.md:23`, `src/manifest.ts:9-20`

**Plain English:** External tooling (other plugins, CI checks, agents verifying their environment) has no committed contract for the manifest. The `version: 1` field already exists; the schema is stable but undocumented.

**Problem:** Stable schema treated as internal detail.

**Fix:** Add a "Manifest format" subsection to README documenting the entry shape (`uuid, kind, event, commandPath, createdAt`), the version, and a note: "agents may read this file; do not modify."

**Effort:** Small

---

### P3-7: `HOOK_PREFIX` not exported

**Status:** `done`

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Verified — literal `cc-forge-caveman-mode-tracker.cjs` appears in install.ts:16 and doctor.ts:13 as `CAVEMAN_HOOK_FILE`.

**File(s):** `src/claude.ts:9`, `src/commands/install.ts:16`, `src/commands/doctor.ts:13`

**Plain English:** `HOOK_PREFIX = 'cc-forge-'` is module-private in claude.ts. But callers know the convention by writing the full filename literal in three places. Renaming the hook means changing three files in lockstep.

**Problem:** Duplicated convention.

**Fix:** Export `HOOK_PREFIX` and a `cavemanHookFilename()` helper. Or just export the full filename as a constant.

**Effort:** Small

---

### P3-8: `JSON.parse` cast to `SettingsShape` without null/array guard

**Status:** `done`

**Category:** correctness

**Confidence:** high

**Confidence rationale:** Verified — the cast trusts `JSON.parse`'s `any` return.

**File(s):** `src/settings-patcher.ts:41-47`, `src/settings-patcher.ts:216-225`

**Plain English:** If a user's settings.json is `null` or `[]`, both are valid JSON but neither is a `SettingsShape` object. Downstream code accessing `settings.hooks` would NPE.

**Problem:** The type cast is a lie.

**Fix:** After parse, validate: `if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SettingsParseError(new Error('settings.json must be a JSON object'))`. Apply the same guard to `readSettingsLocalSafe`.

**Effort:** Small

---

### P3-9: `packageRoot()` duplicated across install + uninstall

**Status:** `done`

**Category:** duplication

**Confidence:** high

**Confidence rationale:** Identical 3-line function in two files.

**File(s):** `src/commands/install.ts:11-14`, `src/commands/uninstall.ts:16-19`

**Plain English:** The same 3-line function appears in both files. The old codebase had it in install.ts; the rewrite propagated it to uninstall.ts.

**Problem:** Cheap duplication.

**Fix:** Move `packageRoot()` to `src/claude.ts` (or `src/paths.ts`) and import.

**Effort:** Small

---

### P3-10: `CLAUDE_DIR` not centralized

**Status:** `done`

**Category:** duplication

**Confidence:** high

**Confidence rationale:** Verified — 4 files independently call `path.join(os.homedir(), '.claude', ...)`.

**File(s):** `src/claude.ts:5-7`, `src/manifest.ts:6`, `src/settings-patcher.ts:6-7`, `src/commands/doctor.ts:20`

**Plain English:** Four files re-derive the base `~/.claude` path. The pattern was established in `src/claude.ts:5-7`; new modules each ignored it.

**Problem:** If the base ever needs to change (e.g., `CLAUDE_CONFIG_DIR` env var support), four files need to update.

**Fix:** Export `CLAUDE_DIR` constant from `src/claude.ts`; have manifest/settings-patcher/doctor consume it.

**Effort:** Small

---

### P3-11: Doctor revalidates flag-file with stricter checks than hook

**Status:** `done`

**Category:** duplication

**Confidence:** medium

**Confidence rationale:** Verified — doctor.ts:114-134 reimplements the hook's symlink/size/whitelist checks.

**File(s):** `src/commands/doctor.ts:114-134`, `hooks/cc-forge-caveman-mode-tracker.cjs:64-87`

**Plain English:** Doctor re-implements the symlink check, size cap, and content whitelist with slightly different error messages. If the hook is the only writer (and `safeWriteFlag` enforces that), doctor only needs: does the file exist, is the content one of three values.

**Problem:** Belt-and-suspenders.

**Fix:** Collapse to ~3 lines: read file (handle ENOENT), trim+lowercase, check `CAVEMAN_LEVELS.includes`.

**Effort:** Small

---

### P3-12: Doctor's settings.local.json overlay check is speculative

**Status:** `done`

**Category:** maintainability

**Confidence:** medium

**Confidence rationale:** Verified — no cc-forge code path creates the conflict it warns about; the comment at line 104 admits it's informational.

**File(s):** `src/commands/doctor.ts:88-105`

**Plain English:** The overlay check only fires if the user has manually duplicated the cc-forge hook in settings.local.json. cc-forge never writes there itself. This is "just in case" code for a first-hook ship.

**Problem:** Speculative complexity.

**Fix:** Delete lines 88-105 and the `readSettingsLocalSafe`/`settingsLocalPath` exports if no other caller. Re-add when there's evidence the case matters.

**Effort:** Small
