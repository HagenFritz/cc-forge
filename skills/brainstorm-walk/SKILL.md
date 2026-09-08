---
name: brainstorm-walk
description: >
  Walk through a requirements document interactively, one requirement at a time. Reads a
  requirements doc produced by /brainstorm, renders each `R`-bullet verbatim with a
  plain-English teach moment, then offers accept / modify / remove / add term / skip.
  Unfamiliar concepts go to a personal glossary without interrupting the walk, and
  `**Reviewed:**` state is written inline in the doc so progress is durable and
  resumable. Triggers on phrases like "walk the requirements", "walk the brainstorm",
  "review these requirements with me", "brainstorm-walk", or passing a path to a
  docs/brainstorms/*-requirements.md file.
user-invocable: true
argument-hint: "[path to docs/brainstorms/*-requirements.md]"
allowed-tools: Bash, Read, Edit, Write
---

# Brainstorm Walk

Guide a human through a `/brainstorm`-produced requirements doc one **requirement** at
a time. Each `R`-bullet is rendered verbatim, explained in plain English, and then
acted on. The requirements document is the source of truth — `**Reviewed:**` state
lives inline, so walks resume cleanly across sessions.

This skill **consumes** requirements docs. It never plans them (that is `/blueprint`),
never writes code, never adds requirements, and never renumbers them.

It slots between `/brainstorm` and `/blueprint` and is entirely optional: a
requirements doc that is never walked behaves exactly as it does today.

`/brainstorm-walk` is to a requirements doc what `/blueprint-walk` is to a plan and
`/review-walk` is to a review doc. The three share a shape deliberately; where this one
diverges, the divergence is called out in place.

## Step 1: Resolve the Requirements Path

- If the user passed a path, use it. Verify the file exists with `ls`.
- If no path was passed, auto-discover the newest requirements doc:

  ```bash
  ls docs/brainstorms/*-requirements.md 2>/dev/null | sort | tail -1
  ```

  The filename convention is `YYYY-MM-DD-NNN-<slug>-requirements.md`, so a
  lexicographic sort picks the most recent doc deterministically (no `mtime`
  ambiguity if the file was edited mid-walk). It also orders same-day docs by their
  `NNN` sequence, which `mtime` gets wrong whenever an earlier doc was edited later.

  The glob is repo-root-relative. Run it from the repo root; from a worktree, note that
  `docs/` is a symlink to the primary checkout's, so the same command resolves there.

  Not every requirements doc carries an `NNN` sequence — the oldest ones are
  `YYYY-MM-DD-<slug>-requirements.md`. The sort still orders them correctly by date;
  only same-day ordering depends on the sequence.

- If no requirements docs exist, STOP and tell the user to run `/brainstorm` first.
- Confirm the resolved path back to the user before continuing:
  > "Walking requirements: `docs/brainstorms/<file>.md`. Proceed?"
  Use `AskUserQuestion` with Yes / Cancel.

## Step 2: Read the Doc and Check the Precondition

Read the full requirements doc. Find its `## Requirements` section and count the
top-level bullets carrying an `R`-ID — an `R` followed by digits and a period at the
start of a list item, either bare or wrapped in bold:

```bash
grep -c -E '^- (\*\*)?R[0-9]+\.' docs/brainstorms/<file>.md
```

**Both forms are live in the corpus and both are walkable.** Current docs write
`- R1. **Title.** …`; one older doc writes `- **R1.** …` with the ID inside the bold.
The ID is what matters, not how it is emphasized, so the pattern accepts either — and
whichever form a doc uses, **preserve it**. Read each requirement's actual prefix from
the doc and reuse that exact text when anchoring or writing; never normalize one style
to the other, since rewriting a prefix edits requirement text the user never asked to
change.

Requirements may also be split under `###` subsection headings inside
`## Requirements` (one older doc groups its twelve requirements under two). Those
headings are **not** walk stops and get no verdict — walk the `R`-bullets beneath them
in doc order, exactly as if the headings were not there. Render a heading as context
when you first reach a requirement under it, so the user sees which group they are in.

Detection is **structural**, never by the doc's `date:` or by any version marker.

**One or more matches → walk them.** Announce the count briefly:

> "Requirements doc has 12 `R`-bullets — walking them in order."

Note the requirements' order as they appear in the doc. **Doc order is walk order.**
Never reorder, and never renumber.

### 2a. Zero `R`-bullets is a hard stop

If `## Requirements` contains no `R`-IDed bullets in **either** accepted form, **STOP
here** — before the read-only context render of Step 3 and before any write of any
kind. Leave the file byte-identical: no `.bak`, no edit, nothing.

This is a **precondition, not a defect**. A requirements doc with plain unnumbered
bullets is legal `/brainstorm` output — that shape is what `/brainstorm` produces for a
doc with only one to three simple requirements. The doc is fine; it just cannot be
walked, because there is no stable ID to anchor review state to or to cite from a later
plan.

Say exactly that, and name the fix:

> "This doc's `## Requirements` bullets aren't `R`-numbered, so there's nothing to
> anchor review state to. That's a legal `/brainstorm` shape for a short doc, not a
> broken file — I've changed nothing. To walk it, number the bullets `R1` … `Rn`
> (`- R1. **Title.** …`) and re-invoke."

**There is no fallback mode.** This is a deliberate divergence from `/blueprint-walk`,
which degrades to a read-only section-by-section walk when a plan has no units. The
divergence is intentional: a plan without units is an *old-shape* artifact that will
never be regenerated, so a degraded walk is the only walk it will ever get, whereas an
unnumbered requirements doc is a *current-shape* artifact one edit away from being
fully walkable. Offering a degraded walk here would hide the one-line fix. Do not
degrade, and do not offer a read-only walk as a consolation.

## Step 3: Render the Read-Only Context

Once the precondition passes, print the doc's non-requirement sections **once**, before
the first requirement, as orientation. Render each present section's body **verbatim**
and label the whole block read-only:

> "Context (read-only — these sections get no verdict and are never edited):"

Render, in this order, only those that exist in the doc:

- `## Problem Frame`
- `## Success Criteria`
- `## Scope Boundaries`
- `## Key Decisions`
- `## Dependencies / Assumptions`
- `## Outstanding Questions`

**A missing section is the normal case.** `## Dependencies / Assumptions` is absent
from several existing docs and its absence carries no meaning. Omit it silently — do
not note the gap, do not ask about it, and above all never fabricate a section or
infer its contents from the rest of the doc.

`## Next Steps` and the YAML frontmatter are not rendered; they describe what happens
after the doc, not what the doc asks for.

These sections are context for the walk and nothing more. They receive no verdict, they
are never written to, and they are never edited **even when a verdict makes one of them
stale** — retiring a requirement can leave a Success Criterion dangling, and that is
left for the human to reconcile.

## Step 4: Detect the Resume Point

Parse every requirement's `**Reviewed:**` line (requirements without one are
unreviewed). Decide where to start:

1. If any requirement is `**Reviewed:** pending`, **resume there** — a previous walk
   was interrupted after claiming the requirement but before recording a verdict.
   Announce:
   > "Resuming at R4 (last left pending)."
   If more than one requirement is `pending`, resume at the **first** in doc order and
   say so.

   A `pending` requirement takes the entry point even when earlier requirements are
   non-terminal — finishing the interrupted verdict comes first. **Those earlier
   requirements are not abandoned:** after the `pending` requirement gets its verdict,
   fall back to rule 2 and continue from the first non-terminal requirement in doc
   order, which walks back to them. The walk is over when rule 3 holds, never when the
   last requirement is reached.
2. Else, the entry point is the first non-terminal requirement in doc order. Terminal
   values are `accepted`, `modified`, `retired`, `skipped`. A missing `**Reviewed:**`
   line is non-terminal, and so is `pending`.
3. If every requirement is terminal, report completion and exit — jump straight to the
   final summary:
   > "Walk already complete. All N requirements are accepted / modified / retired /
   > skipped."

### 4a. Where the state line lives

`**Reviewed:**` sits on a **two-space-indented continuation line inside the `R`-bullet's
own list item**, after the requirement's last line — sub-bullets included:

```
- R4. **Related entry contents.** Each entry contains:
  - PR number + link (required)
  - No review links.
  **Reviewed:** `accepted`
```

This is not cosmetic and it is not the shape the other two walks use. `/blueprint-walk`
anchors state under a `- [ ] **Unit N:` heading and `/review-walk` under a `### P1-3:`
heading; both of those have a body beneath them, so an unindented state line sits
naturally in it. An `- Rn.` bullet has **no body** — it is a single list item, and an
unindented line placed after it terminates the list, splitting `## Requirements` into
two lists and orphaning every requirement below the insertion point. The indent is what
keeps the state line part of its own bullet.

So when parsing: match `**Reviewed:**` as an **indented continuation of a bullet**, not
as a standalone line under a heading, and associate each one with the nearest preceding
`R`-IDed bullet — that bullet owns it. Note that requirement **sub-bullets are indented
two spaces too**, so indentation alone does not distinguish a state line from a
sub-bullet; the `**Reviewed:**` label is what identifies it.

The `**Reviewed:**` field is the *only* review-state store. Never encode review state in
the requirement's own text, and never in a checkbox — `- Rn.` bullets have none, and
adding one would change the doc's shape for `/blueprint`.

## Step 5: Walk the Requirements

For each non-terminal requirement, in doc order:

### 5a. Render the requirement verbatim

Show the requirement **exactly as written** in the doc — its `- Rn.` line, its bolded
title if it has one, and **every sub-bullet indented beneath it**. Sub-bullets are part
of the requirement, not decoration: several requirements carry three to six of them and
that is where the actual specification often lives. Rendering the `- Rn.` line alone
and dropping what follows is a silent truncation, and the user would be giving a
verdict on text they were never shown.

Never fabricate, summarize, reflow, or trim requirement text at render time. If the
current `**Reviewed:**` state is present, show it too.

### 5b. Teach the requirement

Compose a plain-English explanation of what this requirement is actually asking for:

- Lead with the point in non-jargon terms (e.g. "This one says the walk has to survive
  being interrupted — it writes a marker into the doc before it changes anything, so a
  crash is distinguishable from a clean start.").
- Say why it exists — what breaks or stays broken without it.
- Name what it depends on or interacts with elsewhere in the doc, and what that buys.
- Keep it to **3–6 sentences**. The goal is comprehension, not a lecture.

Explain from the **doc text alone**. **Do not read code the requirement cites.** A
requirements doc describes behavior that does not exist yet — the cited file is either
absent or shows only the pre-change state, so reading it buys nothing and costs walk
momentum. The read-only context from Step 3 is the supporting material; use that. If a
requirement is genuinely unexplainable from its own text plus that context, say so
plainly rather than inventing context.

### 5c. Ask the action question

Ask via `AskUserQuestion`:

- **Accept** — the requirement is right as written; mark it reviewed and advance.
- **Modify** — something is wrong; describe it, and the skill drafts a replacement.
- **Remove** — this requirement should not be built; retire it in place.
- **Add term** — capture an unfamiliar concept to the glossary. **Does not advance the
  requirement** — the menu is re-asked afterward, and review state is untouched.
- **Skip** — no verdict now; move on. Reported at the end as *unreviewed*, never as
  accepted.

`Add term` (and any request for a deeper explanation) is a **self-loop**: handle it,
then re-ask this same question on the same requirement. Both are repeatable any number
of times on one requirement. That is the entire point of the side-buffer — learning
must not cost the review thread.
