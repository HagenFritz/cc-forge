---
name: term-quiz
description: >
  Quiz the user on terms from the personal glossary at ~/.claude/glossary.md using Leitner
  spaced repetition. Picks overdue terms first, asks a question type keyed to each term's
  box, grades on meaning, and writes the new box and due date back per item. Triggers on
  phrases like "quiz me", "test me on my terms", "run the glossary quiz", or /term-quiz.
user-invocable: true
argument-hint: "[n]"
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

# Term Quiz

One session of retrieval practice over the glossary. Everything about the file — where it
lives, the entry shape, reading rules, backup, the write protocol, dates, and the Leitner
boxes and intervals — is owned by [glossary](../glossary/SKILL.md). Follow that spec; this
skill adds the question types, the grading, and the loop around them.

This skill **never creates the glossary**. An empty glossary is not something a quiz should
manufacture.

## Step 1: Setup

1. Parse the argument as `n`, the number of terms to ask. Default `8`. A non-integer or
   `n < 1` is ignored — use 8 and say so in one line ("`abc` isn't a number — asking 8.").
2. Get today's date with the spec's [date command](../glossary/SKILL.md#dates). Run it;
   never use the date injected into the session, and never do date arithmetic in your head.
3. `ls ~/.claude/glossary.md` per the spec's [creation guard](../glossary/SKILL.md#creating-the-file).
   Missing, or present with no `## ` sections, stop with one line:

   > No terms yet — capture one with `/term-add <term>`.

4. Read the file and classify every section per the spec's
   [reading rules](../glossary/SKILL.md#reading-rules): term, definition, `Example`, `Not`,
   `Related`, box, due.

## Step 2: Select

Order all sections:

1. **Overdue** (`due` ≤ today) first, most days overdue first.
2. Then **not yet due**, lowest box first, earliest `due` breaking ties.

Take the first `min(n, section count)`. Never ask the same term twice in one session.
Shuffle the selection so boxes interleave rather than running in blocks, and — best effort —
keep a term and its `Related` partner non-adjacent. Drop the adjacency rule silently when
the set is too small to satisfy it.

Open with one line naming the split:

> 5 due, topping up with 3 more — 8 terms.

When fewer terms exist than `n`, say so:

> 3 terms in the glossary — asking all 3 of the 8 requested.

## Step 3: Ask, grade, write

For each selected term, in order.

### 3a. Pick the question type

Keyed to the term's current box — a stateless function of the box, so a term climbing the
spec's [Leitner ladder](../glossary/SKILL.md#leitner-boxes) meets every type in turn.

| Box | Type | Needs | Ask |
|---|---|---|---|
| 1 | cued recall | definition | "In your own words, what is **X**?" |
| 2 | cued recall | definition | "In your own words, what is **X**?" |
| 3 | generation | `Example` | "Give me an example of **X** — a different one from the example saved with it." |
| 4 | discrimination | `Not` | Two short scenarios, one built from `Example` (or the definition), one from `Not`: "Which of these is **X**, and why?" |
| 5 | contrast | `Related` | "How is **X** different from **<Related term>**?" |
| 6 | teach | definition | "Explain **X** to a junior engineer in two sentences." |

**Fallback:** when the field a type needs is absent, step *down* to the next satisfiable
type, ending at cued recall. Box 4 with no `Not` asks generation; box 4 with neither `Not`
nor `Example` asks cued recall.

Ask in prose, one question, and **restate no part of the stored definition, Example, Not,
or Related** — showing the answer inside the question is the one thing that destroys the
retrieval. Then wait for free text.

### 3b. Route the reply

- **"explain more"**, or any question rather than an attempt — teach from the stored entry,
  then re-ask the same question. No grade, no write, no advance. Repeatable.
- **"I don't know"** — a deliberate miss. Grade it as one and go straight to 3c.
- **"stop"** — end the loop and go to Step 4. Everything already written stays.
- Anything else is an answer.

### 3c. Grade, then write, then speak

**The order is fixed: grade → write → feedback → scaffold.** The write happens before a
word of feedback is printed, so an interruption at any point after it loses nothing.

**Grade binary — correct or miss.** Correct means the core meaning is right, in whatever
words the user chose; different phrasing, an informal register, or a missing detail all
still pass. A miss is an answer whose meaning is wrong, inverted, or a definition of a
different term. Nuance never moves the box — it goes in the feedback.

**Write** per the spec's [write protocol](../glossary/SKILL.md#write-protocol) and
[backup](../glossary/SKILL.md#backup) rules, computing the new box and due date from the
spec's [Leitner table](../glossary/SKILL.md#leitner-boxes) with its date commands. A term
with no `*Quiz:*` line, or an unparseable one, gets a canonical line written for it.

**Feedback**, immediately after the write: name what the answer got right, then name
specifically what was missing or wrong, then the new state in one clause.

> Right that it's about safe repetition. What's missing is the *same result* part — running
> it twice has to leave the world exactly as running it once did. Box 1, due tomorrow.

### 3d. Miss scaffold

After a miss only, offer recognition as a rescue — never as the question itself. Use
`AskUserQuestion`, single-select, no preview, with three options: the correct definition and
two distractors taken from **other entries' definitions**.

- Labels are 1–4 word handles; the definition text goes in the option `description`.
- Reject any distractor whose meaning overlaps the correct answer — a near-synonym makes the
  question unfair and teaches nothing.
- Fewer than two surviving distractors → **skip the scaffold entirely**. The feedback in 3c
  already stood on its own.

Acknowledge the pick in one line. **The pick never affects the box or the due date** — it is
already graded and already written.

## Step 4: Close

Reached at the end of the list or on "stop", either way.

1. **Re-ask every missed term once**, as cued recall, in the order they were missed. Same
   feedback shape as 3c. **No grading, no write** — this is a last look, not a second
   chance.
2. **Re-read the file** and print one line per term that was graded this session. Derive the
   box and due date from the file, never from session memory, so the summary cannot
   over-report a write that failed:

   > - idempotency · correct · box 3 · due 2026-09-09
   > - back-pressure · miss · box 1 · due 2026-09-03
   > - memoization · correct · box 2 · due 2026-09-05

Terms not reached before "stop" are not listed. **No definitions are printed at close** —
re-reading definitions feels like learning and is not; the re-ask in step 1 is the retrieval
that does the work.

## Example exchange

Box 2, cued recall:

> **In your own words, what is idempotency?**
>
> — "you can call it a bunch of times and nothing extra happens"
>
> Right — repeating the call is safe, which is the whole point. Sharper: it's not just that
> nothing extra happens, it's that the end state matches a single call exactly. Box 3, due
> 2026-09-09.
