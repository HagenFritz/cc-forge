---
name: stack
description: Run a configured app worktree's own local stack — Next.js web, LangGraph backend, and Postgres on a per-worktree slot — and report its URLs, state, and logs. Invoke as `/stack [up|down [slot]|restart|status|logs]`; with no argument it shows `status`. Use when the user asks to "start the stack", "spin up the app for this worktree", "stop the stack", "free a slot", "what stacks are running", "show the stack logs", or invokes /stack.
argument-hint: "[up|down [slot]|restart|status|logs]"
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/stack.sh *)
---

Run the bundled script and relay what it prints. The script owns parsing, context checks, slots, ports, the 12-hour clock, and teardown; this skill only passes the arguments through. The app-specific values (main checkout, container names, the shared credentials database, what to neutralize in a copy) live in the gitignored `${CLAUDE_SKILL_DIR}/stack.local.conf`, copied from `${CLAUDE_SKILL_DIR}/stack.example.conf`; without it, every command but `check` and `down --worktree` stops with `stack: no stack configured`.

```
${CLAUDE_SKILL_DIR}/stack.sh <command> [slot]
```

`$ARGUMENTS` is passed as-is. Empty means `status` — it is read-only and runs from the main checkout too, so a bare `/stack` can never start or remove anything by accident.

| Command | What it does | How to run |
| --- | --- | --- |
| `up` | Start this worktree's stack, claiming the lowest free slot 1–9; on a running stack, re-report the URLs and restart the clock | `run_in_background` |
| `restart` | Reinstall, re-migrate, and restart on the same slot, keeping the data | `run_in_background` |
| `down [slot]` | Remove this worktree's stack, database included, or the named slot's | foreground |
| `status` | Every stack on the machine: slot, state, time left, ports, branch, worktree | foreground |
| `logs` | Tail of this worktree's `db`, `backend`, `web`, and `timer` logs | foreground |

The script also has `url` and `check`, which other skills call; this skill never runs them, and never runs `expire`, which belongs to the per-slot launchd timer.

Things the user will see:
- The first `up` on a fresh worktree is slow: installs, a ~300 MB copy of main's database, then the branch's migrations.
- A stack seeded from main has its copied background work neutralized (scheduled jobs paused, pending sends and pushes marked done), so it never repeats main's side effects.
- Integrations use main's credentials database, so main's Postgres container must be running for them to work.
- LangSmith traces go to `<project>-wt<N>`, where `N` is the slot.

## Rules

- Run only when the arguments are empty, exactly one of `up`, `restart`, `status`, `logs`, or `down` optionally followed by one digit 1–9. Nothing else goes on the command line. Otherwise, do not run the script: print `usage: /stack [up|down [slot]|restart|status|logs]` and stop.
- Invoking is the confirmation. No prompts — not before `up`, not before `down`, not before `down <slot>` on someone else's worktree; the script's `removed slot <N> (<worktree>)` line names what went.
- Run `up` and `restart` with `run_in_background` and relay the result when the job completes; run every other command in the foreground.
- Never work around the script's context check. Outside a configured app's worktree only `status` and `down <slot>` run; for anything else, relay the script's `stack:` line and stop — never `cd` somewhere else to make it pass.
- On exit 0: show stdout verbatim in one fenced code block — never paraphrase, reflow, or trim it.
- On exit 1: show the stderr verbatim in a fenced code block. If the command was `up` or `restart`, then run `logs`, read them, and add one line stating the cause, citing the log file's full absolute path. Never fix, retry, or restart on your own.
- On exit 2: relay the usage text and stop.
- No preamble and no trailing summary.

## After the first end-to-end run

Once one worktree's stack has run end to end, tell the user it is now safe to remove the old fixed-port terminal startup arrangement and its profiles, and leave that cleanup to them. The main checkout's Postgres container stays as is.

## Examples

`/stack up` (in a worktree)
> ```
> stack: slot 2 is up
>   web:      http://localhost:3002
>   backend:  http://127.0.0.1:2026
>   postgres: 127.0.0.1:5437
>   slot 2, stops in 12h00m
>   The copy's background work is neutralized in this stack; integrations use main's credentials.
> ```

`/stack up` failing
> *(fenced block with the `stack: …` line and log tail)*
>
> Backend failed: migration `0042_add_index` raised `relation "tasks" does not exist` — ~/.local/state/cc-forge-stack/slot-2/logs/backend.log

`/stack down 3` (from the main checkout)
> ```
> removed slot 3 (/path/to/app-worktrees/feat-12-foo)
> ```

`/stack nuke`
> usage: /stack [up|down [slot]|restart|status|logs]
