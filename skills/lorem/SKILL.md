---
name: lorem
description: Generate deterministic lorem ipsum at an exact size and copy it to the clipboard. Invoke as `/lorem <n> [chars|words|paragraphs|tokens]` — the count comes first, the unit defaults to words. Use when the user asks for "lorem ipsum", "placeholder text", "filler text", or "dummy text" of a given length, or invokes /lorem.
argument-hint: "<n> [chars|words|paragraphs|tokens]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/generate.cjs *)
---

Run the bundled generator and present exactly what it prints. The script owns parsing, generation, size caps, and the clipboard; this skill only passes the arguments through.

```
node ${CLAUDE_SKILL_DIR}/generate.cjs <n> [unit]
```

`$ARGUMENTS` becomes `<n>` and the optional `[unit]`, passed as-is. The script accepts `chars`, `words`, `paragraphs`, `tokens`, their singulars, and the one-letter forms `c`, `w`, `p`, `t`. Large requests are capped, and the script names the cap when one is hit. `tokens` is an estimate measured by Haiku 5.5's counter, so it needs the `ANTHROPIC_API_KEY` line in the cc-forge repo-root `.env`.

## Rules

- Run only when the arguments are exactly a positive integer (digits only), optionally followed by one lowercase alphabetic word. Nothing else goes on the command line.
- Never write, edit, extend, or trim lorem text yourself. The script is the only source.
- On exit 0: show stdout verbatim in one fenced code block — never paraphrase, reflow, trim, or regenerate it. Then one line: it was copied to the clipboard, or it was not if stderr says `pbcopy unavailable`. In tokens mode, add the measured count from the `lorem: <m> tokens by Haiku 5.5's counter` line.
- On exit 1 or 2: relay the stderr line verbatim and stop. No fallback text.
- No preamble and no trailing summary.

## Invalid input

If the arguments are empty, the count is not digits only, there are more than two tokens, or the second token is not one lowercase word, do not run the script. Print `usage: /lorem <n> [chars|words|paragraphs|tokens]` and stop.

## Examples

`/lorem 5`
> ```
> Lorem ipsum dolor sit amet,
> ```
> Copied to the clipboard.

`/lorem 200 tokens`
> *(fenced block with the text)*
> Copied to the clipboard — `<m>` tokens by Haiku 5.5's counter.

`/lorem five words`
> usage: /lorem <n> [chars|words|paragraphs|tokens]
