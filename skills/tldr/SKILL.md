---
name: tldr
description: Cap the next response at N sentences and state it in plain language. Invoke as `/tldr <n> [question]` — the leading integer is the ceiling, everything after it is the prompt to answer. Use when the user says "in two sentences", "answer briefly", "explain it simply", "keep it to N sentences", or invokes /tldr. One-shot — applies to this response only.
argument-hint: "<n> [question]"
---

Answer in **at most N sentences**, in **plain, direct language**, where N is the leading integer of the arguments.

Everything after that integer is the actual prompt — answer it. If nothing follows the integer, apply the cap to the answer for the user's previous turn or their next message.

## Rules

- N is a ceiling, not a target. One sentence when one will do.
- No preamble, no trailing summary, no restating the question. The answer starts at word one.
- Content is not the thing being cut — only length. Facts stay exact; drop hedging, filler, and background instead.
- Say it plainly. Short common words over long ones, active voice, concrete subjects. "The check runs too early" beats "there is a temporal ordering issue with the validation invocation."
- No jargon the answer doesn't need. Keep the exact technical term when it *is* the answer — identifiers, error strings, API names, and file paths are never paraphrased — but explain it in ordinary words rather than assuming it.
- A short simple sentence beats one long clause-stacked one. Splitting a dense sentence in two is the right move whenever N allows it.
- If N is genuinely too small for a complete answer, say the most important thing and state in-cap what was left out.

## Not counted against N

Code blocks, file paths, command lines, and list items in a fenced block. Prose sentences are counted.

## Invalid input

If N is missing, not a positive integer, or the arguments are only a question with no leading number, say so in one sentence and answer normally.

## Examples

`/tldr 2 why is the build failing?`
> The `tsc` step fails because `/Users/hfritz/proj/src/api.ts:41` imports a type that the rename deleted. Change that import to `ApiRequest`.

`/tldr 1 should I use a worktree here?`
> Yes — the plan is ready, so run `/tree <issue>` and start a fresh session in the printed path.
