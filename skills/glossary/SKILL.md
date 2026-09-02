---
name: glossary
description: Reference spec for the personal glossary at ~/.claude/glossary.md — entry format, reading rules, dedupe, backup, write protocol, dates, Leitner boxes, and quiet mode. Not a user command.
user-invocable: false
disable-model-invocation: true
---

# Personal Glossary Specification (v1)

The glossary is one file of terms the user is learning, at `~/.claude/glossary.md`.
Three skills write it: `/term-add` (standalone capture), `/term-quiz` (spaced-repetition
state), and `/walk-blueprint` (which routes its `add term` action through `/term-add` in
quiet mode).

This file is the single source of truth for every rule that applies to more than one
skill. Writer skills embed only their own interaction prose inline and reference this
spec for everything else. Never restate a shared rule in a writer skill — not even
paraphrased.

These skills are personal and repo-independent. They never resolve an issue number and
are explicitly outside the [issue-log](../issue-log/SKILL.md) convention — no stamps.

## Where it lives

```
~/.claude/glossary.md
```

It lives **outside every repo on purpose.** Terms accumulate across everything the user
works on — cc-forge, work repos, side projects — and the whole value is one personal
reference that grows over a career, not a per-repo file that resets with each clone.

Consequences, stated to the user once the first time the file is created:

- It is **unversioned** — no git, no history. It is the user's file to hand-edit,
  reorder, or delete freely.
- Hand-editing is the correction path. A writer never asks the user to approve wording.

## File header

A newly created file starts with exactly this:

```markdown
# Glossary

Terms captured for learning. Written by `/term-add` and `/term-quiz`.
```

The header is followed by a blank line, then the first entry — the same blank-line
separator that runs between entries.

## Entry format

One `## ` section per term. Entries are separated by a blank line and kept in **append
order** — never re-sort the file; the user may have arranged it themselves.

```markdown
## Idempotency

An operation you can safely run more than once and get the same result as running it
once. Retrying a failed payment charge is only safe when the charge is idempotent.
**Example:** A "mark as read" endpoint that sets `read = true` can be retried freely; a "deduct $5" endpoint cannot.
**Not:** Determinism — same input, same output — which says nothing about repeating side effects.
**Related:** Retry — the thing idempotency makes safe.
*Quiz:* box 2 · due 2026-09-05
```

Fields, in this order:

- **Heading** — `## <Term>`, the term as the user typed it, nothing else on the line.
  No backticks, no trailing punctuation.
- **Definition** (required) — **at most two sentences**, plain English, written for
  someone meeting the term cold. Any technical word that must appear is explained in the
  same sentence. No jargon-defined-by-jargon, no scoping to where the term was met. When
  the term has several senses, draft the sense the conversation implies — otherwise the
  general software sense — and name that sense in the first clause.
- **`**Example:**`** (required) — **one sentence**, one concrete case.
- **`**Not:**`** (optional) — one sentence naming the nearest thing the term is *not*,
  and the difference. Auto-drafted by the writer; never asked for.
- **`**Related:**`** (optional) — one sentence naming a neighbouring term and how it
  relates. Auto-drafted by the writer; never asked for.
- **`*Quiz:*`** — the scheduling state line, grammar exactly:

  ```
  *Quiz:* box N · due YYYY-MM-DD
  ```

  `N` is an integer 1–6. The separator is a middle dot (`·`) surrounded by single
  spaces. The date is ISO `YYYY-MM-DD`, obtained from the shell (see **Dates**).

`*Seen in:*` is a legacy field from an earlier walk-blueprint format. Nothing writes it
any more; it is preserved verbatim where it already exists (see **Reading rules**).

## Reading rules

- Split the file into sections on `## ` headings. Everything from one `## ` line up to
  the next (or end of file) is that term's section.
- **Unknown lines inside a section are preserved verbatim.** A reader never deletes or
  rewrites a line it does not recognize — legacy entries stay intact without a migration.
- A section with a heading and a definition is **valid**, even with no `**Example:**`,
  no `**Not:**`, no `**Related:**`, and no `*Quiz:*` line.
- A **missing or unparseable** `*Quiz:*` line reads as **box 1, due today**. The next
  writer that grades the term rewrites it canonically (appending it if absent).
- A box outside 1–6 **clamps** to the nearest end of the range. Clamping applies only to
  a line that is otherwise well-formed: if either half fails to parse, the whole line is
  unparseable and the rule above wins. `*Quiz:* box 9 · due 2026-09-05` is box 6 due
  2026-09-05; `*Quiz:* box 9 · due whenever` is box 1 due today.

## Dedupe

**One section per term.** Compare a candidate term against existing `## ` headings
**case-insensitively and trimmed**, so "Idempotency" and "idempotency" are the same
entry.

- **No match** → append a new section at the end of the file.
- **Match** → keep the stored definition. **First capture wins.** Fill in only the
  fields that are *missing* from the stored section (`**Example:**`, `**Not:**`,
  `**Related:**`, `*Quiz:*`); leave every present field byte-identical.
- **Never merge two definitions.** A later capture does not rewrite what the user
  already has. Replace a stored definition only when the user explicitly asks after
  being told it was kept.
- On a match, the **stored heading's casing wins** — it is never rewritten to match what
  the user just typed, and it is the spelling any confirmation line names. `/term-add
  Idempotency` against a stored `## idempotency` leaves the heading alone and reports
  **idempotency**.

## Creating the file

Never assume the file exists. Check with `ls ~/.claude/glossary.md` rather than `Read` —
a `Read` on a missing file errors, and absence is the expected first-run case, not a
failure. If it is missing, write it with the **File header** above, then the first entry.
Mention the creation once, in the confirmation line.

Creating a missing file is not a mutation: it takes **no backup**.

## Backup

Before the **first mutating write of a session** — for any writer — copy the file beside
itself:

```bash
cp ~/.claude/glossary.md ~/.claude/glossary.md.bak
```

The file is unversioned, so this copy is the only recovery path. Take it exactly once
per session; overwrite an existing `.bak` from a previous session without comment. A
session that only reads leaves nothing behind.

## Write protocol

1. **Re-read the file immediately before every write.** Never edit from an in-memory
   copy taken earlier in the session — the user may have hand-edited it meanwhile.
2. **Anchor on the exact full heading line** (`## Idempotency`), never a substring —
   `## Box` and `## Box 1` must not collide.
3. Edit **only the target line**, or append **only the new section**. Nothing else in
   the file changes.
4. A `*Quiz:*` line is inserted as the **last line of its section**, and a rewritten one
   replaces the existing line in place.
5. **A `*Quiz:*` line is never unique on its own.** Two terms captured on the same day
   carry byte-identical lines, so that is the normal state, not a corner case. Match the
   line together with the section line above it — the `**Related:**`, `**Not:**`,
   `**Example:**`, `*Seen in:*`, or definition line it follows — so the edit hits exactly
   one place. Never edit a bare `*Quiz:*` string, and stop rather than guess if the
   two-line match is still not unique.

## Dates

Dates come from the shell, never from arithmetic in the response. They are **measured,
never estimated**.

Today:

```bash
date +%F
```

Today plus `N` days (macOS first, GNU/Linux fallback):

```bash
N=7; date -v+${N}d +%F 2>/dev/null || date -d "+${N} days" +%F
```

## Leitner boxes

Six boxes. Correct → box + 1, capped at 6, with `due = today + interval[new box]`. A
miss → box 1, with `due = today + 1`.

| Box | Interval after a correct answer |
|---|---|
| 1 | 1 day |
| 2 | 3 days |
| 3 | 7 days |
| 4 | 14 days |
| 5 | 30 days |
| 6 | 90 days |

Intervals are **minimum waits**. A term asked long after it came due is not penalized —
sporadic use is expected.

## Quiet mode

When a writer is invoked by another skill in **quiet mode**, the contract is:

- Draft every field itself.
- Ask nothing beyond the term.
- Print nothing back — no entry, no definition, no file summary.
- Confirm in **one line**, then return control to the calling skill immediately.

Standalone invocation is the opposite: the drafted entry is the deliverable and is
printed back.

## Known limitations

- **"explain more" makes the re-ask a recognition test.** Teaching the term and then
  re-asking the same question puts the answer in the turn immediately above it, so the
  grade that follows measures reading, not recall, and a correct answer still promotes
  the box. Accepted deliberately: the alternative is refusing to explain, which is worse
  for someone learning. The next session's ask is the honest one.
- **The `.bak` is per session, not per file lifetime.** A session that captures and then
  quizzes takes its backup before the first mutating write of *that* session, so the copy
  reflects mid-session state rather than the state the user started the day with. It is a
  recovery path for the run in progress, not an archive.

## Versioning

Additive-only within v1 — new optional fields and new writers never bump the version. A
**v2** is required only when an existing field's meaning or grammar changes (e.g. the
`*Quiz:*` separator or the box range).
