---
name: term-add
description: >
  Capture a term into the personal glossary at ~/.claude/glossary.md. Drafts a plain-English
  definition, a concrete example, a near-miss, and a related term, writes the entry per the
  glossary spec, and prints it back. Triggers on phrases like "add a term", "capture this
  term", "define X for my glossary", "what does X mean — save it", or /term-add.
user-invocable: true
argument-hint: "<term or phrase>"
allowed-tools: Bash, Read, Edit, Write
---

# Term Add

One turn: take a term, draft a complete entry, write it, show it. Everything about the
file — where it lives, its header, the entry shape and caps, reading, dedupe, creation,
backup, the write protocol, and dates — is owned by
[glossary](../glossary/SKILL.md). Follow that spec; this skill adds only the interaction
around it.

## Step 1: Resolve the term

The argument is the term. Normalize it: fix obvious spelling mistakes and apply standard glossary casing (lowercase unless it's a proper noun or acronym), but otherwise preserve multi-word phrases and punctuation.

With no argument, ask exactly one question, in prose (not `AskUserQuestion`):

> "What term should I capture?"

That is the only question this skill ever asks. Take the answer as the term and continue.

## Step 2: Draft the entry

Draft every field yourself — the definition, `**Example:**`, `**Not:**`, and
`**Related:**` — from the conversation's context plus general knowledge, to the shape and
caps in the spec's [entry format](../glossary/SKILL.md#entry-format). When the term has
several senses, name the sense you chose in the definition's first clause.

**Never ask the user to supply, confirm, or approve any of it.** They are capturing the
term because they do not know it; asking them to define it inverts the point, and asking
them to approve wording spends a turn on something a hand-edit fixes. The file is theirs
and unversioned — hand-editing is the correction path.

## Step 3: Write

Follow the spec, in order:

1. [Creating the file](../glossary/SKILL.md#creating-the-file) — `ls` guard, never `Read`
   a file that may not exist.
2. [Backup](../glossary/SKILL.md#backup) — once per session, before the first mutating
   write. Creating the file is not a mutation.
3. [Dedupe](../glossary/SKILL.md#dedupe) against existing headings, and
   [reading rules](../glossary/SKILL.md#reading-rules) for what a stored section contains.
4. [Write protocol](../glossary/SKILL.md#write-protocol) — re-read, anchor on the exact
   full heading line, change nothing else.

A new entry's Quiz line is `*Quiz:* box 1 · due <tomorrow>`. Get both dates from the
shell using the spec's [date commands](../glossary/SKILL.md#dates) — run them, never
compute a date in your head, and never use the date injected into the session.

## Step 4: Report

Print the written entry back verbatim — heading through `*Quiz:*`, a handful of lines,
and standalone it *is* the deliverable — then one confirmation line, in exactly one of
these shapes:

> Created `~/.claude/glossary.md` and captured **Idempotency**.

> Captured **Idempotency** to `~/.claude/glossary.md`.

> **Idempotency** is already in `~/.claude/glossary.md` — filled in Example, Related, Quiz.

> **Idempotency** is already in `~/.claude/glossary.md`, nothing to add.

The "filled in" list names only the fields dedupe actually wrote. On the already-present
paths, print the stored section as it now stands rather than your draft — the user's
definition won, and that is what they should see.

## Quiet mode

When another skill invokes this one in
[quiet mode](../glossary/SKILL.md#quiet-mode), Step 1's question is skipped (the caller
supplies the term), Step 4's print-back is suppressed, and only the one confirmation line
is emitted before control returns.

## Examples

`/term-add idempotency`

> ```markdown
> ## idempotency
>
> An operation you can safely run more than once and get the same result as running it
> once. Retrying a failed payment charge is only safe when the charge is idempotent.
> **Example:** A "mark as read" endpoint that sets `read = true` can be retried freely; a "deduct $5" endpoint cannot.
> **Not:** Determinism — same input, same output — which says nothing about repeating side effects.
> **Related:** Retry — the thing idempotency makes safe.
> *Quiz:* box 1 · due 2026-09-03
> ```
>
> Created `~/.claude/glossary.md` and captured **idempotency**.

`/term-add idempotency` again, on an entry that has a definition and nothing else:

> …stored section printed…
>
> **idempotency** is already in `~/.claude/glossary.md` — filled in Example, Not, Related, Quiz.
