---
name: tf
description: Verify a claim, then answer with one word — `true`, `partial`, `false`, or `unknown`. Invoke as `/tf <question>` — everything after `/tf` is the claim to check. Use when the user asks "true or false", "is it true that", "yes or no, is X", or invokes /tf. One-shot — applies to this response only.
argument-hint: "<question>"
disallowed-tools: Edit, Write, NotebookEdit
---

Check the claim in the arguments, then reply with **exactly one lowercase word**: `true`, `partial`, `false`, or `unknown`.

If nothing follows `/tf`, judge the claim in the assistant's previous response, or the user's previous message if that response states no claim.

## Output

- The response is the one word: no punctuation, formatting, or address. This overrides any standing greeting or naming convention for this response; the user asks "why?" next turn if they want one.
- Write no text before, between, or after tool calls.

## Verify first

- Look before answering. Read the code, run read-only commands (`git log`, `grep`, `gh … view`), or search the web. Never answer from memory when a check is possible.
- Read-only only. No edits, no writes through Bash, no commands with side effects. A subagent, if used, is a read-only search type.

## Verdicts

- `true` / `false` — the claim as it is commonly read holds, or fails. Caveats and edge cases the user didn't ask about never downgrade it.
- `partial` — rare. Only when the core claim splits and you can point to both a part that holds and a part that fails, or the answer turns on an omitted condition whose both branches are common. Compound claims: all parts hold → `true`; all fail → `false`; mixed → `partial`.
- `unknown` — rare. Only after looking and still unable to tell, or when the prompt is not a true/false claim (an opinion, a how-to, an open question).

## Examples

`/tf /land merges and pushes a commit to update CLAUDE.md`
> partial

`/tf is tabs better than spaces?`
> unknown
