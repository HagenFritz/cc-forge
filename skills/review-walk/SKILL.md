---
name: review-walk
description: >
  Walk through a code-review document interactively. Reads a review file produced by
  /review, presents related issues group-by-group with a plain-English teach moment
  per group, then steps through each member issue offering implement / defer / skip /
  explain more. Updates `Status:` inline in the doc so progress is durable and
  resumable. Triggers on phrases like "walk the review", "step through the review",
  "review-walk", or passing a path to a docs/reviews/*.md file.
user-invocable: true
argument-hint: "[path to docs/reviews/*.md]"
allowed-tools: Bash, Read, Edit, Write, Agent
---

# Review Walk

Guide a human through a code-review document one **group of related issues** at a time.
For each group, teach the underlying concept in plain English before stepping into
specific fixes. The review document is the source of truth — `Status:` updates live
in the doc, so walks resume cleanly across sessions.

This skill **consumes** review docs produced by `/review`. It does not run reviewers
or produce new findings.

## Step 1: Resolve the Doc Path

- If the user passed a path, use it. Verify the file exists with `ls`.
- If no path was passed, auto-discover the newest review doc:

  ```bash
  ls docs/reviews/*.md 2>/dev/null | sort | tail -1
  ```

  The filename convention is `YYYY-MM-DD-NNN-<slug>-review.md`, so a lexicographic
  sort picks the most recent doc deterministically (no `mtime` ambiguity if the file
  was edited mid-walk).

- If no review docs exist, STOP and tell the user to run `/review` first.
- Confirm the resolved path back to the user before continuing:
  > "Walking review: `docs/reviews/<file>.md`. Proceed?"
  Use `AskUserQuestion` with Yes / Cancel.

## Step 2: Read the Doc and Detect Shape

Read the full review doc. Determine:

- Whether a top-level `## Groups` section is present.
- Whether issues carry the enriched fields (`Category:`, `Confidence:`,
  `Confidence rationale:`, `Plain English:`).

These together determine which mode to run in:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Enriched** | `## Groups` present AND issues have enriched fields | Group-first walk with teach moments. |
| **Fallback** | Either is missing | Issue-by-issue walk in P1 → P2 → P3 order. No teach moments. Status updates still work. |

Fallback exists so the skill is useful against review docs created before the
enrichment landed. Announce the mode briefly:

> "Enriched review doc detected — running group-first walk with teach moments."
> or
> "Older review doc (no Groups section) — falling back to issue-by-issue walk."

## Step 3: Detect Resume Point

Parse every issue's `Status:` line. Decide where to start:

1. If any issue is `Status: in-progress`, **resume there** (a previous walk was
   interrupted mid-fix). Announce: "Resuming at P1-3 (last left in-progress)."
2. Else, the entry point is the first non-terminal issue in walk order. Terminal
   statuses are `done`, `deferred`, `wont-fix`. `open` is non-terminal.
3. If all issues are terminal, report completion and exit:
   > "Walkthrough already complete. All N issues are done / deferred / wont-fix."
   Show a one-line summary of counts by terminal status.

## Step 4: Group Summary (Enriched Mode Only)

Before diving into issues, show the user the lay of the land:

- Total issues, terminal counts so far, groups remaining.
- A short list of group names with member IDs.

Then ask:

> "Start with G1, jump to a different group, or list orphan issues first?"

Use `AskUserQuestion`. Default: start with the first group whose members are not
all terminal.

## Step 5: Walk the Groups

For each group with non-terminal members, in order:

### 5a. Present the group block

Show the group's name, member IDs (with current `Status:` next to each), `Why grouped:`,
`Suggested order:`, and `Cascade:` exactly as written in the doc.

### 5b. Re-read cited files

Collect the unique file paths from the `File(s):` field of each member issue. `Read`
each one (limit to relevant excerpts when the file is large — the issue's line number
gives the anchor). This grounds the teach moment in the current code, not in the
reviewer's snapshot.

### 5c. Teach the underlying concept

Compose a plain-English explanation of what the group is about, framed as a teach
moment:

- Lead with the concept in non-jargon terms (e.g., "Session validation is happening
  in two places, and they disagree on what 'valid' means.").
- Point to one concrete example from the actual code you just read (file + line +
  short quoted snippet if useful).
- Keep it to 3–6 sentences. The goal is comprehension, not a lecture.

Then ask:

> "Ready to step through the issues in this group? (implement / defer / skip / explain more)"

Use `AskUserQuestion` to confirm the user wants to enter the issue loop.

### 5d. Issue loop within the group

For each member issue in `Suggested order:`, in order, skipping any already-terminal:

1. **Present the issue.** Show its title, `Category:`, `Status:`, `File(s):`,
   `Plain English:`, `Problem:`, and `Fix:`. Use the doc's text verbatim.

2. **Noise marker for low confidence.** If `Confidence: low`, prefix the
   presentation with:

   > **Reviewer confidence is LOW** (rationale: `<Confidence rationale>`). Likely
   > safe to skip if it doesn't match your read of the code.

   For `Confidence: medium`, show a softer note: "Reviewer confidence: medium —
   verify before implementing." For `high`, no marker.

3. **Ask the four-action question** via `AskUserQuestion`:
   - **Implement** — apply the fix now.
   - **Defer** — out of scope for this pass; capture a one-line reason.
   - **Skip (won't fix)** — reviewer noise or disagree; close it out.
   - **Explain more** — deeper teaching, then re-ask.

4. **Execute the chosen action** using the Status Update Protocol (Step 7).

When the group's issues are all terminal, proceed to the next group.

## Step 6: Orphan Issues

After all groups are walked, sweep up any issues that were not members of any group.
Walk these issue-by-issue in `P1-* → P2-* → P3-*` numeric order. No teach moment;
present each issue, apply the noise marker rule, ask the four-action question, and
update status.

## Step 7: Status Update Protocol

The review doc is the durable progress store. Every action mutates the issue's
`Status:` line (and sometimes appends fields) using the `Edit` tool, anchored on the
issue's heading + status line so the edit is unambiguous.

### Implement

1. **Before touching code**, set `Status: in-progress` so a crash leaves clear state:

   ```
   Edit the line:
     **Status:** `open`
   under heading `### P<X>-<N>:` → become:
     **Status:** `in-progress`
   ```

2. Apply the fix described in `Fix:`. Read the file, make the edit. Follow the doc's
   instructions; do not invent scope. If the fix is unclear, ask the user before
   editing code.

3. After the fix is in place, set `Status: done`:

   ```
     **Status:** `in-progress` → **Status:** `done`
   ```

4. Briefly confirm to the user what changed and which file(s).

### Defer

1. Ask: "One-line reason for deferring P<X>-<N>?"
2. Set `Status: deferred` and append a new line directly below the Status line:

   ```
     **Status:** `deferred`
     **Defer reason:** <one-line reason from the user>
   ```

   Anchor the edit on the existing `**Status:** \`open\`` line under the issue's
   heading.

3. Do not change any other fields. Do not modify code.

### Skip (won't fix)

1. Set `Status: wont-fix`. No reason field required, though the user may volunteer
   one — if so, append `**Skip reason:** <text>` the same way as defer.
2. Do not modify code.

### Explain more

1. Provide a deeper plain-English walkthrough of the concept. Aim for the level of
   detail that would let the user explain it to a colleague. Quote the actual code
   you re-read in Step 5b.
2. Re-ask the four-action question. Do not change `Status:`.

### Edit anchoring rule

Status edits must be unique. Anchor each `Edit` call on the **two lines together**:
the `### P<X>-<N>:` heading line and the `**Status:**` line directly under it (with
the blank line between them included in `old_string`). This guarantees uniqueness
even if multiple issues happen to share a Status value.

Example `old_string`:

```
### P1-3: Missing CSRF check on logout

**Status:** `open`
```

→ `new_string`:

```
### P1-3: Missing CSRF check on logout

**Status:** `in-progress`
```

## Step 8: Final Summary

After all issues are terminal:

- Show counts by terminal status: `done`, `deferred`, `wont-fix`.
- List deferred items with their reasons (the user may want these as follow-up
  tickets).
- Suggest next steps:
  - If any `done` issues require code changes that aren't yet committed → suggest
    `/ship`.
  - If many `deferred` items exist → suggest opening follow-up issues via
    `/issue-from-context` or `/side-quest`.

## Fallback Mode Details

When running in fallback mode (no `## Groups` section or no enriched fields):

- Skip Step 4 entirely.
- Skip Step 5a/5b/5c (no teach moment, no group block, no re-read for grounding).
- Walk issues in strict `P1-* → P2-* → P3-*` numeric order.
- Apply the four-action question as in enriched mode.
- For the noise marker: if the issue has no `Confidence:` field, skip the marker
  entirely (don't fabricate confidence).
- Status updates work the same way.

## Rules

- Never edit code without setting `Status: in-progress` first.
- Never fabricate `Confidence:`, `Category:`, or `Plain English:` values when they're
  missing from the doc. Fallback mode handles their absence gracefully.
- Never skip the user's chosen action (e.g., don't "implement" when they said
  "defer").
- The review doc is the source of truth. If the user manually edits the doc
  between turns, re-read it before the next action so changes are picked up.
- Respect the Protected Artifacts rule from `/review`: never apply a fix that would
  delete or gitignore files under `docs/brainstorms/`, `docs/plans/`, or
  `docs/solutions/`. If such an issue slipped through, treat it as automatic
  `wont-fix` and warn the user.
