---
name: compact-prep
description: 'Prepare a compaction handoff document before you run /compact. Distills the current session into a fresh-agent-ready doc at docs/handoff/, then prints an @-reference to paste after compaction so a fresh-context agent can resume. Always interactive — asks what the next session should focus on and confirms ambiguous state before writing. Use when the user says "prep for compaction", "write a handoff doc", "before I compact", "context is getting full", or invokes /compact-prep.'
argument-hint: "[optional session focus hint]"
---

# Prepare a Compaction Handoff

**Note: The current year is 2026.** Use this when dating handoff documents.

Claude Code compaction (auto or `/compact`) discards exactly the context that is expensive to lose — early decisions, verification gaps, the *why* behind current state, and forward intent that lives only in your head. There is no supported way to point `/compact` at a file, so the durable bridge across a reset is a disk file you re-reference into the fresh window. This skill writes that bridge: it gathers objective state, asks you to fill the gaps a transcript can't, writes the doc, and prints the reference you paste after you compact. It does not run `/compact` itself and is not a resume executor.

## Core Principles

1. **Fresh-agent first** - Optimize the doc for an agent with zero prior context. Exact paths, exact next action, explicit "not verified" — over prose.
2. **Capture what the transcript can't** - The session records what happened; only the user knows what's next and whether ambiguous state is done or half-done. Ask.
3. **Gather objective state before asking** - Read git and the session first, so questions target genuine gaps, not things the skill can determine.
4. **Keep it lean** - Prune dead ends and side investigations so the fresh agent isn't misled.

## Interaction Rules

1. **Ask one question at a time** - Do not batch several unrelated questions into one message.
2. **Prefer single-select multiple choice** - Use single-select when choosing one direction, one priority, or one next step.
3. **Use the platform's question tool when available** - Prefer the platform's blocking question tool (`AskUserQuestion` in Claude Code, `request_user_input` in Codex, `ask_user` in Gemini). Otherwise, present numbered options in chat and wait for the reply before proceeding.
4. **Always ask the next-step question** - See Phase 1 for the full R3a/R3b/R3c question-gating logic.

## Optional Focus Hint

<focus_hint> #$ARGUMENTS </focus_hint>

If a focus hint is provided, use it to bias the `## Task` line and to prioritize which threads matter. If empty, infer the task from the session.

## Phase 0: Gather Objective State

Before asking anything, collect what you can determine yourself.

Run:

```bash
git rev-parse --abbrev-ref HEAD        # branch
git log -1 --oneline                   # last commit
git status --short                     # uncommitted / untracked
git diff --name-only                   # unstaged changes
git diff --cached --name-only          # staged changes
```

Also check whether the branch is pushed (e.g. `git status -sb` showing `ahead`/behind, or `git rev-parse --abbrev-ref @{upstream}`). If any command above fails (not a git repo, detached HEAD, or a repo mid-rebase/mid-merge), do not guess — write `unknown (not a git repo)` or `unknown (mid-rebase/merge)` as appropriate for the affected `## Git State` fields and continue.

Then review the current session context and build a draft of every section in the Phase 2 template below, using the focus hint (if given) for `## Task` and the commands above for `## Git State`. Two sections carry rules beyond their heading: for `## Verification`, do **not** mark anything tested that the session or user did not confirm; for `## Where Things Live`, note why each file matters, not just its path. Leave `## Next Steps` for the user to supply in Phase 1.

If the session has little or no prior context to distill (e.g. run immediately after `/resume` or at session start), say so explicitly in `## Current State` (e.g. "Session just started; no prior work to summarize") rather than inferring or fabricating activity.

## Phase 1: Interactive Questions

Ask one at a time, per the Interaction Rules.

**R3a — Next-step intent (ALWAYS ask):**
Ask what the next session should focus on first. Use the answer to populate `## Next Steps`, intent-first and in order. This is the skill's core value — the fresh agent's entry point.

**R3b — Ambiguity resolution (ask only on real gaps):**
For any state item you could not disambiguate from the session or git — e.g. "is the X refactor finished or partway?", "did test Y actually pass or was it just written?" — ask the user to confirm before writing it. This keeps `## Current State` and `## Verification` truthful. Skip if state is already clear.

**R3c — Inclusion decisions (ask only if side threads exist):**
If the session contains side investigations, abandoned approaches, or dead ends, ask whether to include or drop each so the doc stays lean. Skip if there's nothing to prune.

## Phase 2: Name and Write

1. Ensure `docs/handoff/` exists. If `.gitignore` does not already contain a `docs/handoff/` entry, append one (handoff docs are ephemeral session artifacts).
2. Build the filename: `docs/handoff/YYYY-MM-DD-NNN-<kebab-case-slug>.md`. Check existing files for today's date to determine the next sequence number (zero-padded to 3 digits, starting at 001). Derive the slug from the task. Immediately before writing, re-verify the chosen filename does not already exist; if it does, increment the sequence number.
3. Write the document using this exact structure:

```markdown
---
date: YYYY-MM-DD
sequence: NNN
branch: <current-branch>
topic: <kebab-case-slug>
---

# <one-line task title>

## Task
<one-line goal of the session>

## Next Steps   <!-- fresh agent starts here -->
1. <intent-first, exact action>
2. ...

## Current State
- Done: ...
- In progress: ...

## Where Things Live
- `path:line` — what / why

## Verification
- ✅ tested: ...
- ❌ NOT verified: ...

## Git State
- branch: <name>
- last commit: <sha oneline>
- pushed?: yes/no
- uncommitted: <count / short summary>

## Gotchas & Open Questions
- ...
```

4. Verify the write succeeded — re-read the file at the path you just wrote and confirm it exists with the expected content — before proceeding to Phase 3. If the write failed, stop here and report the error to the user; do not print the resume reference in Phase 3, since it would falsely claim a safety net that doesn't exist.
5. Confirm the path:

```text
Handoff doc written to `docs/handoff/[filename]`.
```

## Phase 3: Print the Resume Reference

Only reach this phase if Phase 2 step 4 confirmed the write succeeded. Print the exact line for the user to paste **after** they run `/compact`:

```text
Ready to compact. This skill does not run /compact for you.

1. Run /compact
2. Paste this as your first message in the fresh context:

   @docs/handoff/[filename] — continue from here
```
