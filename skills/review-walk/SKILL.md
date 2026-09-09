---
name: review-walk
description: >
  Walk through a code-review document interactively. Reads a review file produced by
  /deep-review, presents related issues group-by-group with a plain-English teach moment
  per group, then steps through each member issue offering implement / defer / won't fix /
  add term / explain more. Unfamiliar concepts go to a personal glossary without
  interrupting the walk, and `Status:` is updated inline in the doc so progress is
  durable and resumable. Triggers on phrases like "walk the review", "step through the
  review", "review-walk", or passing a path to a docs/reviews/*.md file.
user-invocable: true
argument-hint: "[path to docs/reviews/*.md]"
allowed-tools: Bash, Read, Edit, Write, Agent
---

# Review Walk

Guide a human through a code-review document one **group of related issues** at a time.
For each group, teach the underlying concept in plain English before stepping into
specific fixes. The review document is the source of truth — `Status:` updates live
in the doc, so walks resume cleanly across sessions.

This skill **consumes** review docs produced by `/deep-review`. It does not run reviewers
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

- If no review docs exist, STOP and tell the user to run `/deep-review` or `/quick-review` first.
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

Then confirm the user is ready to begin:

> "Starting with <G1 name>. Ready?"

Use `AskUserQuestion` with Yes / Stop. **Groups are walked in doc order, always.** Do
not offer to jump to a different group, reorder them, or take orphan issues first —
the doc's order is the walk's order, and a group whose members are all terminal is
passed over silently rather than offered as a choice.

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

> "Ready to step through the issues in this group? (implement / defer / won't fix / add term / explain more)"

Use `AskUserQuestion` to confirm the user wants to enter the issue loop.

### 5d. Issue loop within the group

For each member issue in `Suggested order:`, in order, skipping any already-terminal:

1. **Present the issue.** Show its title, `Category:`, `Status:`, `File(s):`,
   `Plain English:`, `Problem:`, and `Fix:`. Use the doc's text verbatim. Also show
   `Sweep:` when present — its reason is why [`/review-sweep`](../review-sweep/SKILL.md)
   left this finding for a human.

2. **Noise marker for low confidence.** If `Confidence: low`, prefix the
   presentation with:

   > **Reviewer confidence is LOW** (rationale: `<Confidence rationale>`). Likely
   > safe to skip if it doesn't match your read of the code.

   For `Confidence: medium`, show a softer note: "Reviewer confidence: medium —
   verify before implementing." For `high`, no marker.

3. **Ask the action question** via `AskUserQuestion`:
   - **Implement** — apply the fix now.
   - **Defer** — out of scope for this pass; capture a one-line reason.
   - **Won't fix** — reviewer noise or disagree; close it out. Terminal: this is a
     decision, not a deferral. The other two walks use *skip* for "no verdict yet";
     this walk has no such action.
   - **Add term** — capture an unfamiliar concept to the glossary. **Does not advance
     the issue** — the menu is re-asked afterward, and `Status:` is untouched.
   - **Explain more** — deeper teaching, then re-ask.

   Ask this question for **every** issue, one at a time. Never collapse several issues
   into one question, and never offer a batch verdict — not even when the rest of the
   group looks alike.

   `Add term` and `Explain more` are **self-loops**: handle it, then re-ask this same
   question on the same issue. Both are repeatable any number of times on one issue.
   That is the entire point of the side buffer — learning must not cost the review
   thread.

4. **Execute the chosen action** using the Status Update Protocol (Step 7).

When the group's issues are all terminal, proceed to the next group.

## Step 6: Orphan Issues

After all groups are walked, sweep up any issues that were not members of any group.
Walk these issue-by-issue in `P1-* → P2-* → P3-*` numeric order. No teach moment;
present each issue, apply the noise marker rule, ask the 5d action question — `Add term`
included, behaving identically here — and update status.

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

3. After the fix is in place, set `Status: done` and append an `Applied:` line directly
   below it recording how closely the landed change followed the doc's `Fix:`:

   ```
     **Status:** `done`
     **Applied:** <as-written | reworked | partial> — <one line: what changed, and what differed from `Fix:` if anything>
   ```

   - `as-written` — the `Fix:` was applied as described.
   - `reworked` — the problem was fixed, but by a different change than `Fix:` described.
   - `partial` — only part of `Fix:` landed; say which part did not and why.

   You made the edit, so you pick the code — never ask the user for it.

4. Briefly confirm to the user what changed and which file(s).

### Defer

1. Ask why with `AskUserQuestion` — one question, these options, `Other` allowed:
   - **follow-up-pr** — real and wanted, but belongs in its own change
   - **needs-decision** — someone has to decide something before this can be fixed
   - **blocked-on** — waits on another change, a migration, a release, or an external party
   - **bigger-than-scoped** — the real fix is larger than the finding describes
2. Set `Status: deferred` and append a new line directly below the Status line, per the
   **Reason line format** below:

   ```
     **Status:** `deferred`
     **Defer reason:** <code> — <free text>
   ```

   Anchor the edit on the existing `**Status:** \`open\`` line under the issue's
   heading.

3. Do not change any other fields. Do not modify code.

### Won't fix

1. Ask why with `AskUserQuestion` — one question, these options, `Other` allowed. A
   reason is required; there is no "no reason" option:
   - **misread** — the reviewer got the code wrong; the problem is not there
   - **by-design** — the behavior is intentional
   - **not-worth-it** — real, but the fix is out of proportion to the problem
   - **accepted-risk** — real and understood; consciously carried as-is
   - **pre-existing** — real, but not introduced by this change
   - **tracked-elsewhere** — already covered by an issue, a plan, or an idea doc
2. Set `Status: wont-fix` and append the reason directly below the Status line, per the
   **Reason line format** below:

   ```
     **Status:** `wont-fix`
     **Skip reason:** <code> — <free text>
   ```

3. Do not modify code.

### Reason line format

`Defer reason:` and `Skip reason:` share one shape: `<code> — <free text>`, one line, sitting
directly under `Status:`. The code is what future analysis of review docs keys on; the free
text is for humans.

- **A listed option chosen** → that code, then ` — ` and the user's own words if they added
  any. If they added none, the line is the code alone.
- **`Other` typed** → the user's text is kept **verbatim** after the dash, and you pick the
  code it fits best. Choose from the list for that verdict; if nothing fits, the code is
  `other`. Never rewrite, shorten, or "improve" what they typed — the code is your reading
  of it, the text is theirs.
- Never invent a reason the user did not give, and never leave the code out.

### Add term

1. Capture the term to the glossary (**Capturing a term to the glossary**, below).
2. **Do not touch `Status:`.** No status write of any kind, and no code edit.
3. Re-ask the 5d action question on the same issue. Repeatable.

### Explain more

1. Provide a deeper plain-English walkthrough of the concept. Aim for the level of
   detail that would let the user explain it to a colleague. Quote the actual code
   you re-read in Step 5b.
2. Re-ask the 5d action question. Do not change `Status:`.

### Capturing a term to the glossary

Where `Add term` routes. Follow
[the walk-protocol spec](../walk-protocol/SKILL.md#capturing-a-term) exactly — it owns
the side-buffer contract, the one-answer flow, and the delegation to `/term-add` in
quiet mode. Re-ask the 5d action question on the same issue afterward.

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
- Report **terms added** — how many terms this session captured to
  `~/.claude/glossary.md`. Unlike the status counts, this one *is* session-scoped: the
  glossary is shared across every doc the user walks, so re-reading the review doc
  cannot tell this walk's captures from an earlier walk's. Count Step 7's confirmation
  lines, which name the term. A capture that reported the term was already present
  counts too — the user looked it up, which is what the number is for. Omit the line
  entirely when no term was captured.
- Offer tracking issues for the deferred items (Step 8a), then stamp the walk
  outcome (Step 8b).
- Suggest next steps:
  - If any `done` issues produced code changes, check whether the current branch has
    an open PR (`gh pr view --json state,number`):
    - **Open PR exists** (the remote-review flow — this walk ran against a shipped PR):
      suggest **`/review-push`**, which commits the fixes, pushes them onto the PR
      branch, and posts a PR comment mapping each finding to its outcome (fixed /
      deferred / skipped). That skill owns the commit+push+comment; don't do it here.
    - **No PR**: suggest `/ship`.

### 8a. Tracking Issues for Deferred Items

Derive the deferred list by re-reading the doc's `Status:` lines — never from
session memory — so a walk resumed across sessions covers every deferred issue,
not just this session's. If none are `deferred`, skip to 8b.

**Filing an issue is never a side effect.** An issue is outward-facing and
persists after this session, so it takes an explicit, informed yes — not one
inferred from the user having deferred a finding. **Default to filing nothing.**
If the user has not said to create issues, propose and stop; a walk that ends
with zero issues filed is a normal, correct outcome.

Resolve `<owner>/<repo>` from `git remote get-url origin`. Then ask once via
`AskUserQuestion`:

> "File tracking issues for the <n> deferred items?"

- **Skip** — create nothing. **This is the default option**: list it first, and
  select it if the user dismisses the prompt or answers ambiguously.
- **Pick which** — let the user select a subset, then create those.
- **Create all** — one issue per deferred item.

Skip any deferred item whose doc entry already carries a `Tracking:` line — a
resumed walk must not re-file issues that exist.

**Then confirm what will be filed, not just the count.** The prompt above
approves the *batch*; it names not one of the issues it would create. Before the
first `gh issue create`, compose every issue body and ask once more via
`AskUserQuestion`. Set the `preview` field on the **File them** option to a
metadata stub only — never the bodies. The bodies are far larger than the
preview panel and will fail to render:

```
<title> (<N> lines)
<title> (<N> lines)
```

One line per item, in doc order.

- **File them** (description: "Create these issues as listed") — carries the
  stub preview
- **Edit** — the user revises a title or body in free-form; recompose and
  re-confirm. First print the full composed title + body of the item being
  revised as ordinary message text (not in a `preview` field) so the user can
  read what they are revising — print it at most once per revision round, and
  skip the print if this round's body has already been printed. If the input
  names no item and the batch holds more than one, print nothing and ask which
  item they mean. Then treat the input as revision notes, regenerate that
  item's title and body accordingly, and re-ask with the updated stub.
- **Cancel** — file nothing, leave every `Status:` line untouched.

Batching every item into one prompt keeps this to two questions total, however
many items are deferred. Do not skip this second confirm because the first was
answered "Create all" — that answer is consent to a count, while this one shows
which issues those are. It is a weaker guarantee than showing the bodies: the
titles establish identity, not contents, and the bodies are one **Edit** away
for a user who wants to read them before saying yes.

For each item being created, build the body from the shared
[issue template](../issue-from-context/issue-template.md) — same structure
`/issue-from-context` uses — filled from the review doc:

- **Summary**: the finding's one-line description plus its defer reason
- **Evidence**: the finding's `Problem:` section
- **Expected**: the finding's `Fix:` section
- **Actual (if bug)** / **Repro (if applicable)**: fill when the finding is a
  bug with observed behavior; otherwise "n/a"

Write the filled template to a temp file with the Write tool, then:

```bash
gh issue create \
  --repo <owner>/<repo> \
  --title "<the issue's title from its review-doc heading>" \
  --label "follow-up" \
  --body-file <temp-file>
```

- If the command errors because the `follow-up` label doesn't exist, re-run
  without `--label` and tell the user the label is missing on this repo.
- **Immediately after each successful create**, add a `Tracking:
  <owner>/<repo>#<n>` line under that item's `Status:` line in the review doc —
  this is the durable record; Step 8b's list is derived from it, and an
  interrupted batch resumes without duplicates.
- If a create fails for any other reason, note the item and continue with the
  rest; after the loop, report which deferred items did **not** get a tracking
  issue. Step 8b's stamp must reflect the shortfall (e.g. `Tracking: 2 of 4
  filed — P2-3, P2-5 failed`), never silently list only the successes.

After the loop, report every created issue's URL from its `gh issue create`
output, one per line, so each is one click away:

```
<P<X>-<N> title> — <issue-url>
```

### 8b. Stamp the Walk Outcome

The stamp fires only here, at final summary — a walk abandoned before Step 8
posts nothing. Statuses come from the doc's `Status:` lines (`done` →
implemented, `deferred` → deferred, `wont-fix` → skipped), so resumed walks
report correctly. Issue-number resolution (including the skip when none
resolves), posting mechanics, marker encoding, and failure handling are defined
in [the issue-log spec](../issue-log/SKILL.md).

Compose the body below, write it to a temp file with the Write tool, and post:

```markdown
<!-- cc-forge-log v1: {"skill":"review-walk","event":"review-walk-complete","paths":["docs/reviews/<file>.md"],"followup":true} -->

### 🚶 /review-walk — walk complete

**Summary:** <n> issues walked — <n> implemented, <n> deferred, <n> won't fix
**Issues:**
- <P<X>-<N>: short title>
  - <one line on what the issue is>
  - <status>: <why>
- <P<X>-<N>: short title>
  - <one line on what the issue is>
  - <status>: <why>
**Tracking:** <owner>/<repo>#<n>, one ref per `Tracking:` line in the doc — note any shortfall from 8a
**Terms added:** <n> — <term, term, term>
```
```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

Enumerate every walked issue, in doc order. Include `"followup":true` and the
`**Tracking:**` line only when 8a created at least one tracking issue; omit
both otherwise. Omit `**Terms added:**` when no term was captured — its count comes
from Step 7's confirmation lines, tallied at Step 8, not from the doc.

There is no `**Doc:**` field — the walk produces no document of its own, and the walked
review doc's path rides in `paths`.

## Fallback Mode Details

When running in fallback mode (no `## Groups` section or no enriched fields):

- Skip Step 4 entirely.
- Skip Step 5a/5b/5c (no teach moment, no group block, no re-read for grounding).
- Walk issues in strict `P1-* → P2-* → P3-*` numeric order.
- Apply the 5d action question as in enriched mode, showing `Sweep:` when present.
  `Add term` is offered here too — it reads no enriched field and touches no `Status:`,
  so nothing about fallback mode restricts it.
- For the noise marker: if the issue has no `Confidence:` field, skip the marker
  entirely (don't fabricate confidence).
- Status updates work the same way.

## Rules

- Never edit code without setting `Status: in-progress` first.
- Never fabricate `Confidence:`, `Category:`, or `Plain English:` values when they're
  missing from the doc. Fallback mode handles their absence gracefully.
- Never skip the user's chosen action (e.g., don't "implement" when they said
  "defer").
- **Walk order is fixed and every issue is presented individually.** Groups run in doc
  order, `G1` through `Gn`, then orphan issues in `P1-* → P2-* → P3-*` order. Within a
  group, members run in `Suggested order:`. Never reorder, never let the user pick a
  group to start from, and **never offer to batch** — no "implement all of these?", no
  group-level verdict, no bundling several issues behind one question. Each issue gets
  its own presentation and its own action question, even when every issue in a group
  has the same obvious answer and the batch would be faster. The walk exists so each
  finding is looked at; a shortcut that skips presentation defeats it.
- **`Add term` never advances the walk.** It writes only to the glossary, leaves
  `Status:` and the code untouched, and the same action question is re-asked on the
  same issue afterward.
- **Never create a GitHub issue without an explicit, informed yes.** Two confirms
  gate it (§8a): one for the batch, one listing the drafted title of every issue.
  Deferring a finding is not consent to file anything; filing nothing is
  the default and a perfectly good outcome. This holds even when the user's
  project instructions are silent on issues — and where those instructions
  forbid unprompted issue creation, they win outright.
- The review doc is the source of truth. If the user manually edits the doc
  between turns, re-read it before the next action so changes are picked up.
- Respect the Protected Artifacts rule from `/deep-review`: never apply a fix that would
  delete or gitignore files under `docs/brainstorms/`, `docs/plans/`, or
  `docs/solutions/`. If such an issue slipped through, treat it as automatic
  `wont-fix` and warn the user.
