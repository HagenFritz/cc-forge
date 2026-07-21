---
name: issue-log
description: Reference spec for the cc-forge issue-log stamp convention — the marker format, event registry, and reader contract. Not a user command.
user-invocable: false
disable-model-invocation: true
---

# Issue-Log Stamp Specification (v1)

The issue-log convention makes a GitHub issue's comment thread a reconstructable work log. Participating skills post **one comment per event** — a "stamp" — with a hidden machine-readable marker on line 1 and a human-readable body below. A reader (the `/daily-review` skill) parses the markers to rebuild what happened without inference.

This file is the single source of truth for every rule that applies to more than one skill. Writer skills embed only their own filled-in stamp template inline and reference this spec for everything else. Never restate a shared rule in a writer skill — not even paraphrased.

## Envelope

```
<!-- cc-forge-log v1: {"skill":"<skill>","event":"<event>"[, optional keys]} -->

### <glyph> /<skill> — <short outcome>

**<Field>:** <one-liner>
**<Field>:** <one-liner>

<details><summary>Long content (optional)</summary>

…anything long: lists, excerpts…

</details>
```

Rules:
- The marker is **line 1** of the comment body, a **single line**, followed by a blank line. Never inside a code fence or blockquote.
- The marker is an index, not the content: counts and keys in the JSON; lists and prose in the human section.
- Long content goes in `<details>` (blank line required after `<summary>` for inner markdown to render).
- Comment bodies cap at 65,536 characters; truncate the human section if ever near it, never the marker.

## Marker schema (v1)

Required keys:

| Key | Type | Meaning |
|---|---|---|
| `skill` | string | Writer skill name (see registry) |
| `event` | string | Event name (see registry) |

Optional keys:

| Key | Type | Meaning |
|---|---|---|
| `unit` | string | Dedupe key for per-unit events: ordinal + title read from the plan's checkbox heading at stamp time, e.g. `"3: Retrofit /plan and /brainstorm stamps"`. Never the in-session task title. |
| `followup` | bool | Marks the stamp as follow-up material for the daily reviewer |
| `blocked_by` | array | Refs gating a follow-up, each `owner/repo#N` |
| `paths` | array | Local doc/worktree paths this event produced or relies on. `unit-complete`/`unit-blocked` stamps always include the plan path (scopes `unit` dedupe across plans). |
| `pr` | number | PR number for pr events |
| `tracking` | string | `owner/repo#N` of a tracking issue this event created |
| `counts` | object | Small integer tallies for multi-item events, e.g. `{"implemented":1,"deferred":2,"skipped":1}` |

**Versioning:** additive-only within v1 — new optional keys, new event names, and new skills never bump the version. A **v2** is required only when an existing key's meaning or read type changes (e.g. `tracking` string → array). Readers skip unknown versions with a warning.

## Event registry

| Skill | Event | Glyph | Payload fields (human section) |
|---|---|---|---|
| brainstorm | `requirements-written` | 🧠 | Doc path, full requirements list (direct port from the doc) |
| plan | `plan-written` | 📋 | Plan path, unit count, every unit enumerated with a one-sentence summary |
| tree | `worktree-created` | 🌳 | Branch, worktree path (also in `paths`) |
| branch-from-issue | `branch-created` | 🌱 | Branch |
| work | `unit-complete` | 🔨 | **Did** (always), **Solved** (only when a problem was solved) |
| work | `unit-blocked` | ⚠️ | **Blocked:** reason; optional `blocked_by` |
| deep-review | `review-written` | 🔍 | Severity counts + the findings table from the terminal summary (per-P1/P2 rows, P3 roll-up) |
| review-walk | `walk-complete` | 🚶 | Summary line + every walked issue as "what — status: why"; tallies in the marker's `counts`; tracking refs for deferred items filed as issues |
| side-quest | `side-quest-filed` | 🧭 | What was found, tracking-issue link (`tracking`, `followup:true`) |
| ship | `pr-created` | 🚀 | PR link (`pr`), one-line summary |
| land | `pr-merged` | ✅ | 2-3 sentence summary of what landed + follow-ups (user-confirmed prose) |

Event names are these exact strings. New events join this table before any skill emits them.

Document-producing skills (brainstorm, plan, deep-review, side-quest) start the human body with a `**Doc:**` field holding the repo-relative doc path, and carry the same path in the marker's `paths`.

## Encoding rule

The payload must never contain the sequence `--` — it can terminate the HTML comment and expose the marker. When serializing any string value (including `unit` titles), replace `--` with `- -`. This applies to the human section's marker line only, not the body below it.

## Issue-number resolution

Precedence, evaluated top-down; first hit wins:

1. Explicit argument to the skill
2. Issue already established in session context (e.g. via `/read-issue`, `/triage-issue`)
3. Branch name: split on `/`, second segment if a positive integer (`feat/57/issue-log-stamps` → 57)
4. PR body: `Closes #N` / `Fixes #N` / `Resolves #N`
5. Doc frontmatter (`issue:` in side-quest docs)

If nothing resolves, **skip the stamp silently** — no error, no prompt. Skills that predate the issue (brainstorm on `main`) skip routinely; this is normal.

## Posting

- Post with `gh issue comment <n> --repo <owner>/<repo> --body "$(cat <<'EOF' … EOF)"` — always the heredoc form; embedded JSON and backticks break bare `--body` quoting.
- Fixed-format stamps post **unconfirmed**. Stamps containing drafted prose shown to the user for approval (land's `pr-merged`) keep their existing preview-confirm flow; the marker line is part of the previewed body.
- **Failure is never fatal and never silent**: if the comment fails after the skill's real work succeeded, report one line — `couldn't stamp #<n>: <reason>` — plus the manual command, and continue. Closed issues accept comments; locked ones don't.

## Dedupe semantics

Writers never dedupe; re-runs may emit duplicate events (re-ship after a PR close, worktree recreate, resumed `/work` re-stamping a unit). Concurrent sessions are safe by construction — comments are append-only. The **reader** applies latest-wins per `(skill, event, unit)`, scoping `unit` by the plan path carried in `paths`.

## Reader contract

Consumers (the `/daily-review` skill) must:

1. Fetch comments via `gh api repos/{owner}/{repo}/issues/{n}/comments --paginate` (raw bodies; `gh issue view --json comments` caps at ~100).
2. Keep only comments whose author is the authenticated login **and** whose first line matches `^<!-- cc-forge-log v(\d+): (\{.*\}) -->$` — both checks, always (quote-replies copy raw markers into human comments).
3. Dispatch on the version capture; skip unknown versions and unparseable JSON with a one-line warning, never fail the run.
4. Apply latest-wins dedupe as above.
5. Treat `paths` values as machine-scoped: check existence before presenting; label dead paths ("worktree removed" / "not on this machine").

## Worked example

A `/work` stamp for unit 3 of a plan, posted to issue #57:

```markdown
<!-- cc-forge-log v1: {"skill":"work","event":"unit-complete","unit":"3: Retrofit /plan and /brainstorm stamps","paths":["docs/plans/2026-07-21-001-feat-issue-log-standard-plan.md"]} -->

### 🔨 /work — unit 3: Retrofit /plan and /brainstorm stamps

**Did:** Added plan-written stamp after issue creation; brainstorm stamps only when an issue is known in session.
**Solved:** Plan stamps fired before the issue existed — moved the stamp after the optional issue-creation step.
```

Round-trip check: the REST API returns this body byte-identical; the reader regex captures version `1` and valid JSON.
