# Dashboard

Live terminal dashboard for monitoring Claude Code sessions across projects. A single self-contained script (`dash.js`) using only Node stdlib modules (Node >= 22 required). Not plugin-loaded — run by hand in its own terminal tab.

## Install

Run it directly with `node dashboard/dash.js`, or install the `ccdash` launcher once per machine (not committed — per-machine, like `~/.local/bin/devbox`):

```bash
cat > ~/.local/bin/ccdash <<'EOF'
#!/usr/bin/env bash
#
# ccdash — launch the cc-forge session dashboard from anywhere.
# Named ccdash, not dash: macOS ships /bin/dash (the Almquist shell) and /bin
# precedes ~/.local/bin on PATH. Per-machine install, not committed to the
# repo. Install: write this file, then chmod +x. See dashboard/CLAUDE.md.
set -euo pipefail

target="/Users/hfritz/Misc/cc-forge/dashboard/dash.js"

[ -f "$target" ] || {
  echo "ccdash: dashboard not found at $target — has the cc-forge checkout moved?" >&2
  exit 1
}

exec node "$target" "$@"
EOF
chmod +x ~/.local/bin/ccdash
```

The path is hardcoded, and the guard turns a moved checkout into a clear message instead of a Node `MODULE_NOT_FOUND` trace.


## Conventions

- One file, sectioned by `// ── Section ──` comments.
- No external dependencies; `child_process`, `crypto`, `fs`, `http`, `https`, `os`, `path` only.

`https` is there for one thing: the dashboard makes an outbound API call per session turn, sending that turn's last assistant message to Anthropic to summarize it (see *Summaries*). It is the only network call the program originates — the VM listener receives, it does not fetch. Every failure on that path falls back to the raw transcript tail, so the dashboard still runs offline, with no key, and behind a proxy it cannot reach.

Flags:

- `--once` prints one plain frame and exits (the smoke-test flag). No keys, no bell, no help line, and no network call — the summarizer is never armed, so the frame stays byte-stable.
- `--width <n>` fixes column width (used by `--once` for reproducible frames).
- `--fixture <path>` feeds synthetic rows for deterministic output.
- `--alert-idle` also bells on idle transitions; waiting-only by default.
- `--listen <port>` moves the VM listener off its default `127.0.0.1:45801` (1024–65535). Live mode only — it cannot be combined with `--once`.
- `--no-listen` runs live mode without the VM listener, for a Mac with no devbox.

## Columns

`STATE  AGE  NAME  SKILL  AGENTS  DIR  SUMMARY`.

**SKILL** is the last slash command the session ran — the last `<command-name>` in its transcript, leading `/` stripped, a leading `forge:` stripped after that. It persists until the next command: the transcript carries no end-of-skill signal, so "still in it" and "finished it" are indistinguishable and the last one is the better guess. Eleven built-ins are blocked outright (`model`, `compact`, `mcp`, `plugin`, `reload-plugins`, `clear`, `help`, `config`, `artifacts`, `tasks`, `workflows`) because they say nothing about the work; `/model` alone was the single most frequent command in the transcripts this was measured against. The `forge:` prefix is stripped **before** the blocklist is consulted, so a namespaced name cannot smuggle a blocked one through. That ordering was wrong on the first pass — the lookup tested the still-prefixed name against a set holding bare ones, so `/forge:model` missed the blocklist and then rendered as `model`, the exact value the check exists to hide. Capped at 14 code points through the same `truncate()` the rest of the table uses (see *Column drop order* for why 14). Blank when the session has run no command.

**AGENTS** is how many subagents the session has dispatched and not yet seen finish — the count only, never a name, since one name out of six running is misleading. `-` when zero, which anchors the column rather than leaving a ragged gap. The count is the size of an id-keyed map, so the zero floor is structural rather than a clamp.

Agents pair off by their dispatch's own **`tool_result`**, not by `<task-notification>`. Measured across 1,071 real dispatches: 181 produce no notification at all, while a `tool_result` is present for 100% — notifications only cover the background case, so pairing on them alone left every foreground agent running forever, with a corpus-wide phantom tail of 39. Notifications are still read, because they are the only signal for a completion that lands mid-turn, and they arrive in three shapes — string content, and a `type:"attachment"` record with `attachment.type:"queued_command"` carrying the payload in `attachment.prompt`. A `prompt_snapshot` attachment is deliberately not read: it quotes whole notifications inside its system prompt rather than reporting one, so reading it would pair off live dispatches. For the same reason, skill detection never reads `tool_result` content — transcripts echo command names quoted inside files agents have read, and every `<tool-use-id>` found inside one session's `tool_result` blobs during this work belonged to a different session.

**VM rows show blank SKILL and `-` AGENTS**, for the same reason they have no SUMMARY: the emitter payload carries a state and a tmux session name, nothing else, and reading a VM transcript would mean an ssh round trip per row per tick. Both columns return early on `row.remote` before any path is built, so a VM `cwd` cannot mangle into a real local transcript path.

Both columns are fed by an **incremental scan**, not by the backward tail SUMMARY uses. SKILL and AGENTS are whole-history questions — the last `<command-name>` sits anywhere, and dispatches pair with completions across the whole file — so a bounded tail cannot answer them, and a full re-read costs ~130 ms on the largest real transcript (50.1 MB; 62 of 205 transcripts exceed the 1 MB tail-retry ceiling). At 5–10 rows on a two-second tick that is up to ~1.3 s of synchronous work per tick in the paint path. The `summaryCache` size+mtime key does not absorb it: an actively-appending session invalidates it every tick, which is exactly when these columns matter. So only the bytes appended since the last tick are read, behind a substring prefilter that keeps 1,489 lines of 8,156 on that 50 MB file out of `JSON.parse`. Measured at under a millisecond. A delta is capped at 8 MB per tick and cut at the last newline **in bytes, not in the decoded string** — a chunk can end mid-character, and decoding that substitutes a replacement character whose byte length is not the one that was read. `scannedTo` advances only after every line in the chunk has parsed, so a throw mid-chunk rescans rather than silently skipping. A file that shrank, or whose mtime moved backward, was rotated or replaced and resets the entry.

## Column drop order

SKILL and AGENTS drop together first, then SUMMARY, then DIR. The new columns going first is the point: a narrow pane should shed what was just added rather than the summary that has always been there.

The thresholds depend on how wide the rows' own names and directories are, since NAME and DIR size to their content up to their caps. Measured against `layout()`:

| widest name / dir in frame | DIR from | SUMMARY from | SKILL+AGENTS from |
|---|---|---|---|
| 8 / 8 | 35 | 47 | 71 |
| 16 / 20 | 43 | 67 | 91 |
| 24 / 30 (both caps) | 51 | 85 | 109 |

The bottom row is the worst case. SKILL caps at 14 because 20 pushed that worst case past the 122-column panes this runs in; the later gutter change bought enough headroom that it would now fit either way, but 14 is what is measured here and the cap stays. Every real terminal here (122–281 columns) keeps all seven columns, now with 13 columns to spare where it used to have none.

`COLUMN_GAP` is 2, not the 4 it shipped with. At 4, plus the per-column padding each field already carries, neighbouring columns sat 10 to 24 display columns apart and the table read as scattered islands rather than a grid. The two columns that gap gave back went to SUMMARY, which is the only column that was ever short of room: it starts at 77 rather than 90 on a 122-wide frame. `AGE_WIDTH` is 5 for the same reason — `formatAge` maxes at `1h00`, so 6 was padding a 4-character worst case.

There is no horizontal scrolling. It would add scroll state, two keybindings, and a repaint-while-scrolled rule to serve widths below ~90 that do not occur here. Silent graceful degradation matches how focus and tab-ordering already degrade off a Mac.

## Colour and styling

Colour is **additive and never load-bearing**. `waiting!` keeps its trailing marker, the AGENTS zero state stays `-`, and `stale` stays a word — every meaning in the table survives a pipe, `NO_COLOR`, or a terminal that drops SGR. `colorEnabled` is set only in `runLive`, gated on `!process.env.NO_COLOR && process.stdout.isTTY`, so `--once` emits zero escape bytes and stays byte-stable for the smoke test.

Status carries the palette: amber `waiting!`, green `busy`, plain `idle`, dim `stale`, dim chrome (the header, the `-` placeholder, the `●` on agent lines).

Two rules make the column math survive colour, and both are easy to get wrong:

**Escapes are applied after padding, never before.** An escape is code points that occupy zero display columns, so padding a string that already contains one pads to the wrong width. `pad` and `truncate` measure through `displayWidth`, which discounts SGR.

**Spans are recoloured rightmost-first.** Inserting an escape shifts every code-point offset to its right, so colouring STATE before AGENTS lands the AGENTS span in the gap before its own cell.

The summary column styles what it contains, since a wall of one weight has to be read rather than glanced at:

| what | how | why |
|---|---|---|
| passed, done, verified, merged, green | green | 82 of 573 real messages carry one |
| failed, broken, blocked, error, bug | red | 37 of 573 |
| file paths, `path:line` | dim | context, not the point of the sentence |
| `#113` | amber | a pointer you act on — the same register as `waiting!` |
| quantities with units | bold | the figure is the content |
| `**bold**` from the model | bold | its own emphasis |

Passes run **markdown → paths → numbers → outcome words**, and each skips text already inside an escape. That ordering is what keeps `error-handler.js` one dim path rather than a path containing a red word, and `dash.js:1092` one filename rather than a filename beside a bolded line number.

Bare counts are deliberately unstyled: they appear in 279 of 573 messages and would light up half of every sentence. A number earns emphasis when it carries a unit, which is when it means something. Measured on the same corpus, 99.8% of messages contain no number-with-unit at all, so the emphasis-spam case that a benchmark-shaped summary would produce is not reachable with this user's text.

Truncation and wrapping both cut through spans, so `truncateStyled` and `splitStyled` close whatever is open at the cut and reopen it on the continuation. They track **openers** rather than closers because SGR 22 ends bold and dim alike — mapping a closer back to an opener silently reopened bold spans as dim.

## Summaries

SUMMARY is the session's last assistant message, wrapped to at most two lines, and summarized by Haiku.

**Every session row occupies exactly two lines**, whether or not its summary wraps. Variable row height was the cause of the table appearing to jump: a summary landing, or swapping from the raw tail to its Haiku replacement, changed a row's line count and reflowed every row below it. Row order was never the culprit — `sortRows` keys on tab order and `startedAt`, neither of which tracks status. A short summary leaves the second line blank rather than drawing a rule; the blank reads as breathing room between rows.

`scanTail` decodes from the first newline **in bytes**, not from the raw window offset. Decoding from an arbitrary offset turns a character straddling it into a replacement character. The damage was always confined to the leading partial line, which was discarded anyway, so this fixed a latent class of bug rather than a visible one — the retry path re-opens the window mid-character and would have carried it further.

The wrap breaks at the last space that fits, since a mid-word cut reads as corruption rather than as a wrap; a single token longer than the column has no space to break at and is cut hard. The continuation is built through `renderLine` against the row's own cell array rather than as a hand-prefixed string — a raw string skips the per-column truncation and would let the continuation run wider than the column it belongs to. An overflow that is empty after trimming emits nothing, because `renderLine` strips trailing whitespace and a blank line inside the table is worse than a clipped one.

**The dashboard sends the last assistant message of each session, capped at 2,000 characters, to `api.anthropic.com` to summarize it, using the operator's own API key.** Always on, no opt-out flag: that text is already Anthropic API traffic — it exists *because* Claude Code sent it there — so summarizing a slice of it re-sends the same data to the same company under the same terms. No new recipient, no new data class.

The key is resolved once at startup, in order: `ANTHROPIC_API_KEY` from the environment, then an `ANTHROPIC_API_KEY=` line in the repo-root `.env`, located relative to the script (`path.join(__dirname, '..', '.env')`) so a clone elsewhere works unchanged. **A clone needs its own `.env` or its own environment variable** — nothing is committed; `.env` and `.env.local` are gitignored, which is necessary but not sufficient against `git add -A`. That file is read with `readToken`'s posture as literal steps: `lstat` before any open so a symlink is refused rather than followed, a refusal above 8 KB, `O_RDONLY | O_NOFOLLOW`, and a fixed `Buffer.alloc` plus a single `readSync` rather than an unbounded read. A mode readable beyond this user is warned about in the footer, not refused — the file is the operator's own, and refusing it would just turn summaries off silently.

One call per **tick in which the transcript changed**, keyed on the same size+mtime the cache is: a tick that finds a request already in flight for that session does not queue a second. Not one per turn — Claude Code appends to a transcript around 13 times per turn, and while most of those land inside a single two-second tick and coalesce, the measured rate is 5 to 8 calls per turn rather than one.

A **global** ceiling of 60 calls per rolling minute bounds the runaway case, and the poll line shows `N/60 summaries/min` once a call has been made, reading `capped` at the ceiling. Global rather than per-session because rate limits are per-account: a per-session interval would not catch several sessions each behaving reasonably. Measured peak for one streaming session is about 30 a minute, so the ceiling is roughly twice a realistic peak — it is there to stop a loop, not to shape normal spend. Nothing in the paint path awaits, so the wrapped raw tail is what shows until the reply lands and what shows again if it does not. A new turn clears the previous summary, so the raw tail returns rather than last turn's summary lingering over this turn's work. Eight-second timeout, no retry, response capped at 64 KB, TLS default-verified — `rejectUnauthorized` is never set.

Every failure collapses to one fixed footer line (`summaries unavailable — showing raw transcript text`) and a row never becomes an error. That is deliberate to the point of being the reason the code is shaped this way: a caught `https` error can carry the request options, headers included, so surfacing a `.message` is the likely path for the key to reach the screen. The key belongs in exactly one place, the outbound request's headers. The note clears on the next success, so a transient failure does not leave it up for the life of the process.

Cost is about 180 input and 40 output tokens a call, roughly $0.0004. At the measured 5-8 calls per turn and three sessions over an eight-hour day, that is $0.45 to $0.70 — not the $0.09 a per-turn model predicts. Sustained at the 60/min ceiling it would be about $1.40 an hour, which is what the ceiling exists to make impossible. Billed to that API key rather than to a Max plan.

The prompt asks the model to bold the subject and backtick any file, function, or flag, because it was returning plain prose — nothing had asked it not to. It complies, and the styling passes above are what render those markers.

**`--once` never calls out.** The summarizer is armed in `runLive` only, so the one-shot frame renders the raw tail, stays byte-stable for the smoke test, and depends on no network. The exported render seam is unarmed for the same reason: arming is a live-mode act, not a render-path one.

## Sort order

Rows follow iTerm tab order, left to right, so row N is tab N and Cmd+number lands where the table says. Ordering is (window index, tab index): "row N is tab N" holds inside the frontmost window, and further windows stack after it in iTerm's own order — Cmd+number only ever addresses the current window's tabs. Two sessions split across one tab take consecutive positions.

Stability is the point. The shipped order was `waiting` / `idle` / `busy`, which moved a row every time its status changed and broke the row-to-tab mapping the keys depend on. `waiting` still has to stand out, so it does it without moving: the STATE cell reads `waiting!`. The marker is one trailing ASCII byte, and it survives every condition colour does not — a pipe, `NO_COLOR`, `--once`, a terminal that drops SGR — at eight characters fitting `STATE_WIDTH` without widening the column.

Two spawns per poll feed the order — one `ps -o pid=,tty=` for every local row's pid, one `osascript` walking `windows → tabs → sessions` for each tty's position — and both run **after** the paint with the result cached in `state.tabByTty` / `state.ttyByPid`. Nothing waits on iTerm: a new tab reaches its sort position one poll late, which is invisible at a two-second interval. One query is in flight at a time, so a slow osascript cannot stack spawns. The script is guarded by `is running` (`tell application` would otherwise launch iTerm) and never activates it, and it is built from `ITERM_BUNDLE_ID` alone — no byte of a row reaches it.

Rows iTerm knows nothing about — VM rows, background sessions, a pid whose tty is gone — sort after the tabbed ones, on `startedAt` then id so they hold their relative order across ticks regardless of status. With no tab order at all (no iTerm, Linux, `--once`) the whole table falls back to the urgency sort, unannounced, the same way focus already degrades off a Mac; `ps -p` exiting non-zero because one pid is gone is the normal case, so its output is the signal there and its exit status is not. A failed or timed-out osascript keeps the previous map rather than clearing it — one hung iTerm would otherwise reshuffle every row for a tick — but only for five consecutive failures, after which both maps are cleared and the urgency fallback takes over; a `ps` failure with nothing on stdout keeps both cached maps for the same reason. The query is skipped outright off darwin, and a watchdog slightly longer than the 3 s timeout kills a wedged child, so the one-in-flight flag cannot strand.

## VM listener

On by default in live mode at `127.0.0.1:45801`, so `ccdash` alone shows VM rows; `--listen <port>` moves it and `--no-listen` turns it off. Bound to loopback only; the VM reaches it over an ssh reverse forward. Every request must be a `POST` carrying `x-dash-token` and `content-type: application/json`, with no `Origin` header; a body over 4 KB is rejected (4096 bytes is the largest accepted), cut off mid-stream with the socket destroyed. Anything else is rejected with 405 / 401 / 415 / 403 / 413 / 400 — the last for a body that is malformed or non-object JSON — and touches no state.

The shared secret lives at `~/.claude/.dash-token`, 64 hex characters, created `0600` at open time and read symlink-refusingly. It is generated on the first `--listen` run and the footer says so until the copy is done; getting it onto the VM, and rotating it, is step 2 of *Wiring the devbox* below. The note clears the moment a VM request arrives carrying a matching token — an authenticated request *proves* the VM holds the copy the note is asking for, so it is cleared immediately after the token check and before the content-type, Origin, body, and size rejections: a malformed body from a correctly-tokened VM still proves the token matched. Two footer fields, not one: `tokenNote` is the clearable mint note, `tokenWarning` the standing "readable beyond this user" warning, which nothing clears. They were one field, and a single field cannot be told apart at clear time except by string comparison — and they are not coexistent under it either, since last write wins. A file that is there but unusable (a symlink, oversized, malformed, or unreadable) is never overwritten: the footer says so and VM rows are off for that run, so a transient read error cannot rotate a secret the VM still holds. A token readable beyond this user gets a footer warning, not a rotation.

The token defends exactly two boundaries: a remote-triggered local request from a context that cannot read the filesystem (a browser tab, a postinstall script), and a non-root process on the devbox. A same-uid process on the Mac reads the token file and is not defended against.

Payload contract — anything else is ignored, `host` included (the host is pinned to `ro-devbox`):

| field | required | meaning |
|---|---|---|
| `sessionId` | yes | the VM session's UUID; namespaced to `ro-devbox:<id>` at ingest |
| `event` | yes | `SessionStart` / `UserPromptSubmit` → busy, `Notification` / `PermissionRequest` → waiting, `Stop` → idle, `SessionEnd` → row removed for 5 s and then re-creatable. `SubagentStop` and anything else is ignored |
| `seq` | yes | monotonic per session; an event at or below the stored value is dropped unless the row has been quiet for the sticky window, which lets an emitter whose counter reset re-register. Above 2^32 is dropped — `Number.isInteger` alone would let one forged event pin the stored value past every real one |
| `emittedAt` | no | accepted in the payload and ignored — staleness, eviction, and the displayed age all derive from the Mac-observed receipt time |
| `name`, `cwd`, `kind`, `tmuxSession` | no | passed through the same `validateRows` boundary as local rows |

A VM row that has been quiet for 10 minutes shows `stale` in the STATE cell, and one quiet for 12 hours is dropped. Both are tick-driven off the Mac receipt time — there is no heartbeat, so silence cannot be told apart from an idle session or a dead forward, and labeling it is the honest answer. Staleness is a flag on the row, not a status: the STATE cell reads `stale`, the AGE keeps counting from the last received event rather than restarting, the row holds its sort position, and a stale row that reports again does not re-ring the bell — it never left the status the bell is edge-triggered on. The next real event replaces the row outright, which clears the flag. Local rows are never aged out.

At most 256 VM rows are held; at the cap the least recently heard-from row is evicted for the new session, so a flood of fresh uuids cannot lock a real session out of the table. The sticky-end map is capped the same way, evicting the soonest-expiring record. Footer counters — rejected VM requests (a stale token copy on the VM) and dropped VM events (out of order, unknown event, or malformed) — each get their own footer line once non-zero, as do a listener that could not bind and the new-token note. Two more footer lines come from the summarizer rather than the listener: a loose mode on `.env`, and the fixed `summaries unavailable` note. One line each, never joined — every frame line is truncated to the terminal width, and the token path alone is long enough to eat the counters.

## Wiring the devbox

Three per-machine steps, none of them committed — the same posture as
`~/.local/bin/ccdash`. `~/.ssh/config` and the token file live outside the repo
on both machines.

**1. The reverse forward, on the Mac.** `~/.ssh/config` already has a
`Host ro-devbox` entry (the IAP `ProxyCommand` `scripts/devbox` relies on), so
these lines are added *inside* it rather than appended as a second block:

```
Host ro-devbox
  # …existing ProxyCommand, User, IdentityFile…
  RemoteForward 45800 127.0.0.1:45801
  ControlMaster auto
  ControlPath ~/.ssh/cm-%C
  ControlPersist 10m
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure no
```

The config is the only place that covers `devbox ssh`, `devbox <name>`,
`devbox cc`, and a hand-typed `ssh ro-devbox` with one edit, which is why
`scripts/devbox` needs no change. `RemoteForward` binds 45800 on the VM and
carries it to the dashboard's listener on 45801 on the Mac. `ControlMaster`, `ControlPath`,
and `ControlPersist` are load-bearing rather than tuning: with `RemoteForward`
set, a second concurrent connection cannot bind the VM-side port, so without a
shared connection only the first `devbox` invocation carries a working forward —
and `devbox` opens a fresh connection per invocation. The sharing exists only
because of `ControlPath`: `ControlMaster auto` with no socket path is a no-op,
and a second concurrent `devbox` invocation then hard-fails on the VM-side port
bind under `ExitOnForwardFailure`. `ServerAliveInterval 30` /
`ServerAliveCountMax 3` tear a dead master down instead of leaving it to be
reused (see *Known limitations*).

`ExitOnForwardFailure` is **`no`**, and that one word is what keeps the forward
from ever taking devbox down with it. Two things are true of a remote forward
through a shared master, both measured on this setup rather than read about: a
multiplexed client re-requests the config's `RemoteForward` through whatever
master it joins, and a forward that request establishes **persists in the
master after the client exits**. So when the port is already held on the VM —
by a zombie an earlier laptop sleep left behind, or by a second live connection
that bound it first — the master connects anyway, and every later call
re-requests the forward until one succeeds, at which point the master holds it.
Self-healing, with no extra round trip. Longer sessions print
`Warning: remote port forwarding failed for listen port 45800` while it is held;
a quick command can exit before the reply lands, so the reliable signal is the
dashboard itself, where the VM rows go `stale`.

At `yes` the same bind failure is fatal: every `devbox` command dies on it, and
a master that did connect without the forward wedges every call multiplexed
through it, since each one re-requests and fails. That was the failure this
section used to document a workaround for. Nothing in `scripts/devbox` has to
know any of this.

How long the port stays held is the VM's call, not the Mac's: its `sshd` runs
`ClientAliveInterval 30` / `ClientAliveCountMax 3` (set by hand in
`/etc/ssh/sshd_config` on the VM — the ai-agents provisioning does not touch
sshd, so a rebuilt VM reverts to the image's 120), so a zombie from a dropped
connection is reaped within about 90 seconds and the next `devbox` call takes
the forward. A live second connection holds it until that session ends, which is
correct — it is forwarding.

The forward reaches the
VM's loopback only, which assumes `GatewayPorts` stays `no` on the devbox (it is
unset today); at `yes` the listener would be reachable from the whole VPC. Check
it with `ssh ro-devbox 'sshd -T | grep -i gatewayports'`. Writing `127.0.0.1:`
on the `RemoteForward` line is not a client-side substitute — per ssh_config(5) a
remote bind address only succeeds when the server's `GatewayPorts` is enabled, so
against today's `no` it would break the forward rather than pin it.

**2. The token, on both machines.** Run the dashboard once (it listens by
default) to generate `~/.claude/.dash-token`, then copy it over in one command:

```bash
ssh ro-devbox 'umask 077; mkdir -p ~/.claude; cat > ~/.claude/.dash-token' < ~/.claude/.dash-token
```

`0600` on the Mac and on the VM. `scp` plus a separate `chmod` is the wrong
shape: `scp` creates the file at the remote umask (typically `0644`) and the
`chmod` leaves a window where it is readable by everyone, and if the `chmod` is
skipped the emitter silently treats the loose mode as absent. `umask 077` makes
the file `0600` at creation instead, and `mkdir -p` covers a fresh VM where
`~/.claude` may not exist yet. The mode protects the token at rest; it is not the
privilege boundary in this design. While the forward is down — or before it is
established — the emitter still POSTs to `127.0.0.1:45800` on the VM, and
whatever process holds that port receives the token in the `x-dash-token`
header, so the emit port is itself a token-disclosure channel and the file mode
is a mitigation. Rotation is delete, restart the dashboard, re-copy; between the
restart and the re-copy the symptom is a rising
`N VM requests rejected` count in the footer, not an error. Outside a rotation, a
rising count means something other than your VM is POSTing to the listener —
investigate it rather than ignore it.

**3. The emitter, on the VM.** cc-forge is already loaded as a plugin there, so
`git pull` in the devbox checkout plus `/reload-plugins` in a session on the VM
is the whole install — `hooks/hooks.json` is wired automatically. Non-interactive
ssh does not source the login profile (`~/.local/bin` is not on `PATH`, so
`claude` is not either), so a remote command runs under `bash -lc`:
`ssh ro-devbox 'bash -lc "cd <checkout> && git pull"'`, where `<checkout>` is the
VM's cc-forge directory — `scripts/devbox` probes `~/`, `~/Projects/`, and
`~/Misc/` for it. `/reload-plugins` is typed inside a Claude session on the VM,
not over ssh.

## Session emitter (VM side)

`hooks/cc-forge-session-emitter.cjs` is the other end of the wire, wired by `hooks/hooks.json` on `SessionStart`, `UserPromptSubmit`, `Notification` (matcher `permission_prompt`), `PermissionRequest`, `Stop`, and `SessionEnd`. It POSTs one event to `127.0.0.1:45800` — `DASH_EMIT_PORT` overrides it — over the ssh reverse forward set up in *Wiring the devbox* step 1 above.

It runs inside the user's session on every prompt, so it never waits: a 300 ms socket timeout, no response body read, silent on every failure, exit 0 on every path — a missing or malformed `~/.claude/.dash-token` just means no VM rows, and a token readable beyond the user is ignored. Only `permission_prompt` reaches the Mac as `waiting`; the matcher narrows it and the payload is checked again in code so an `idle_prompt` never shows a session as blocked. Both permission events are wired because the `Notification` variant is unreliable in an interactive TTY session, where a distinct `PermissionRequest` fires instead (anthropics/claude-code#85171) — `PermissionRequest` needs no payload check, since the event itself is the prompt, and the hook writes nothing to stdout on that path, where JSON would be read as a permission decision.

Per-session `seq` counters live at `~/.claude/dash-seq/<session-id>` (one small `0600` file, written temp+rename, removed on `SessionEnd`), since the hook is a fresh process per event. A counter that goes missing restarts at 0, which the listener's sticky window absorbs. `tmuxSession` comes from `tmux display-message -p '#S'` when `$TMUX` is set and is `null` otherwise, so a plain `devbox ssh` session still reports.

Keys (live mode only):

- Up / Down — move the highlight. **Arrows only; `j` and `k` are not bound.** They were, in the reverse of vi, `less`, `git`, and `tmux` — the binding that matched the owner's hands rather than the convention — and in use they were more distracting than either direction was useful, so they were removed rather than flipped. Agent lines are not selectable; movement indexes sessions only.
- Space — expand the highlighted session into one line per running agent, indented under its row: `● <age> <agent-type> <dispatch description>`. Pressing it again collapses. One session at a time, since two open rosters push the rows under them far enough down that the table stops reading as a list, and a row with nothing running is a no-op rather than a collapse of whatever is already open. The lines show the dispatch `description` from the main transcript — no `subagents/*.jsonl` read, no per-agent summary, no cost. Expansion state is cleared automatically when the row leaves the table or its roster drains: a dead id left set would re-expand a session that reused it, and a drained roster would hold open an empty expansion that the no-op-at-zero rule never gets the chance to close. While renaming, space is a literal character — the rename dispatch sits above this branch in `handleKey`, so the collision cannot happen by construction.
- Enter — focus the highlighted session's iTerm tab. On a VM row there is no pid
  to resolve, so focus instead selects the iTerm tab whose session name contains
  `ro-devbox`, then asks `tmux list-clients -F '#{client_tty}'` over ssh for the
  attached client and runs `tmux switch-client -c <tty> -t <session>` against it,
  both as argv arrays with `-o BatchMode=yes -o ConnectTimeout=2` so an unknown
  host key can never prompt on `/dev/tty`. The client is named explicitly because
  `switch-client` alone moves whichever client tmux saw last, which an iTerm
  select does not change. The AppleScript is built from the host alias alone — no
  byte of a VM row reaches it — and the tmux name reaches only the argv, never an
  interpreter. A row whose `tmuxSession` is `null` focuses the tab and says tmux
  was not detected, and no attached client says so too; an unreachable devbox is
  one transient footer line, bounded by the same 3 s timeout as each other call.
  Only the newest Enter writes the footer, so two overlapping focus attempts
  cannot report out of order, and a quit mid-flight kills the child.
- `r` — rename that session's iTerm tab (inline prompt; Enter confirms, Esc cancels, `^U` clears).
- `q` / `^C` — quit.

The bell rings once per tick when a session newly enters `waiting`.

## Known limitations

- Wide characters (emoji, CJK) misalign columns — widths are code points, not display cells. Declared scope boundary.
- A status string over 16 characters is truncated (`STATE_CAP`).
- Fixture rows always show `0s` age (no `<pid>.json` exists for synthetic pids); by design for deterministic output.
- The module exports only `validateVmRow`, `applyVmEvent`, `newState`, `startListener`, `focusScript`, `renameScript`, `vmFocusScript`, `tmuxListClientsArgs`, `tmuxSwitchArgs`, `focusHighlighted`, `focusVmRow`, `ageOutVmRows`, `renderRows`, `sortRows`, `parseTabOrder`, `parseTtyByPid`, `tabIndexOf`, `handleKey`, `moveHighlight`, `buildTable`, and `reconcileExpanded` — the VM ingest seam, the focus path (which needs iTerm and a live devbox to run for real), staleness, reachable by handing `ageOutVmRows` a clock and `renderRows` the same one to get the decorated, sorted rows back, and tab-order sorting, whose two query outputs cannot be produced off a Mac: the parsers take that output as text, `sortRows` takes the resulting map, and `handleKey` with `moveHighlight` covers movement without a pty. `buildTable` is exported for its `rowLineIndex` map, which is the only way to check that the highlight lands on the right frame line once an expanded roster or a wrapped summary has pushed the rows below it down; `reconcileExpanded` for the two decay paths — row gone, roster drained — that no key press ever reaches. `scanDelta` and `newCacheEntry` are the seam for the counting logic, the one part of the file whose wrong answer is silent: a miscount renders as a plausible number, and did exactly that once. `scanDelta` takes the entry it mutates and never reads `summaryCache`, so a caller supplies its own and drives the reducers under it — dispatch pairing, orphan reclamation, the chunk boundary — against a written transcript, with no cache and no projects tree involved. `skillFor` and `agentsFor` stay off the list for the opposite reason: both take a row, rebuild a path against `PROJECTS_DIR`, and read the module-private cache, so reaching either means laying down transcript files under a simulated tree. This list and the comment above `module.exports` must agree. Anything else, such as `refreshTabOrder`, in-process timing, or a whole rendered frame, needs an instrumented copy or a live run.
- `refreshTabOrder` and `tabOrderScript` are inspection-only seams: neither runs at all without a live macOS with iTerm, so they are deliberately not exported and are covered by the post-merge checklist rather than by a probe.
- `skillFor`, `agentsFor`, and the scan reducers under `applyScanLine` are inspection-only for a different reason, and it was a close call. The reducers are pure over a cache entry and the 1,071-dispatch pairing case is exactly the kind of thing a unit test should lock in — but `skillFor` and `agentsFor` take a *row*, not an entry: each rebuilds a path against `PROJECTS_DIR` and reads the module-private `summaryCache`, so reaching either means laying down real transcript files on disk. That is a fixture seam, not the pure-function seam it looks like, and nothing exported reaches the reducers underneath, so exporting one without the rest buys no coverage. Making `scanDelta`'s cache injectable is the change that would flip this; until then the closed allowlist stays closed.
- A tab opened, closed, or dragged is reflected one poll (two seconds) later, since the tab query runs off the tick.
- Tab order is iTerm-only. In any other terminal the query returns nothing and the table sorts by urgency, silently — the same degradation focus and rename already have.
- A VM session that starts while the dashboard is down is invisible until its next event; there is no heartbeat and the dashboard never polls the VM. An idle VM session goes `stale` after 10 minutes for the same reason, which says only that nothing has been heard — not that the session is gone.
- After a laptop sleep or a network drop the persisted ssh master can be half-dead, so `devbox` invocations hang. Recovery is `ssh -O exit ro-devbox`, then reconnect; the `ServerAlive*` keepalives detect it within about 90 s. A *failure to bind* the reverse forward is a different case and needs nothing: under `ExitOnForwardFailure no` the connection proceeds and the forward is retaken automatically once the port frees (see *Wiring the devbox*).
- VM rows have no SUMMARY, no SKILL, and `-` AGENTS. The emitter carries a state and a tmux session name only — reading a VM transcript would mean an ssh round trip per row per tick.
- SKILL has no end signal, so the last command a session ran stays in the cell after it finishes. There is nothing in the transcript that says a skill ended, and showing the last one is a better guess than blanking on a heuristic.
- **Cold start:** a session already running when the dashboard starts is scanned from its current end, so agents dispatched before that are never counted and its AGENTS cell can read low or `-` while work is genuinely in flight. Once-per-session, not per tick, and it corrects itself as new dispatches land. Documented rather than engineered around — the alternative is the ~130 ms full read this design exists to avoid.
- Agent lines show the dispatch `description`, not what the agent found. Completion notifications carry no findings, and the real output lives in `subagents/*.jsonl`, which the dashboard deliberately never opens.
- `summaryCache` is never evicted: one entry per distinct transcript for the process lifetime. That was harmless when an entry was `{ size, mtimeMs, text }`; it now also holds a running-agent `Map`, an orphan-completion `Set`, a cached summary, and an in-flight request flag. A dashboard left up for days across many sessions is the growth case, and it is accepted as a pre-existing condition rather than bounded.
- The `●` on agent lines is single-width and dim, so the column math holds and nothing depends on it. It carries no state distinction — every agent line is running by construction, since a finished dispatch is deleted from the map rather than marked.
- Markdown in a summary is rendered, not stripped: `**bold**` and backticked spans become SGR. Under `NO_COLOR`, a non-TTY, or `--once` the markers are removed and the text renders plain, so the asterisks never show as literal punctuation either way. Italic uses SGR 3, which some terminals ignore — the failure mode there is unstyled text rather than visible markup.
- The frame is clamped to `process.stdout.rows` by `clampFrame`, which drops session rows from the bottom and reports the count as `… +N more sessions` rather than letting them vanish. Before that, a frame taller than the pane scrolled inside the alt screen and lost the header first. Fixed-height rows are what forced it: at two lines per row a 24-row pane fills at ten sessions where the old variable-height table took about sixteen. `runOnce` passes no height, so `--once` is never clamped and stays byte-stable. The clamp is not reachable from the export list — `buildFrame` is not on it — so it is covered by a live run rather than a probe.
- `r` on a VM row reports that rename is local-only; it renames an iTerm tab, and a VM row has none.
- Permission prompts arrive on two different hook events and both are wired, per *Session emitter* above (anthropics/claude-code#85171). If that is fixed upstream one entry becomes redundant rather than wrong: both map to `waiting`, so a session that emits both pays one redundant event, dropped or applied as a no-op — either way no second bell.
- Transcript reads have no wall-clock guard. The bounded tail SUMMARY uses measures ~1 ms cold, and the incremental scan behind SKILL and AGENTS measures under a millisecond per tick — but a session that appends 8 MB between two ticks pays for parsing that chunk in the paint path, and nothing stops it. The chunk cap bounds the allocation, not the time.
- `DASH_PROJECTS_DIR` env override exists for testing but is not a documented user-facing feature.
- A tab renamed with `r` is overwritten by Claude Code's own OSC 0 title on that session's next turn — the rename is not sticky. Mitigation is the iTerm profile toggle "Terminal may set tab/window title"; there is no scriptable lock.
- A session whose iTerm profile defines a custom title format shows the new name wrapped in that format — renaming to `foo` can render as `foo (cloud-sql-proxy)`. The rename did apply; the profile decorates it. The dashboard reads the name back after setting it and reports the rendered form when it differs from what was typed, so this no longer looks like a rename that did nothing. A separate mechanism from the OSC 0 revert above, and it fires on the first rename rather than on the next turn. Changing it means editing the profile's title format in iTerm.
- Rename input is ASCII printable only (`0x20`–`0x7e`), capped at 64 characters; other keystrokes are ignored.
- Focus and rename are iTerm-only; elsewhere a transient footer message appears and the rest of the dashboard keeps working.
- VM focus snapshots the row when Enter is pressed, so a session that ends while iTerm is being driven leaves the tmux switch pointing at a session that just went away. Accepted, for the same reason the pid-reuse window is.
- One devbox tab is assumed: focus takes the first iTerm session whose name contains the host alias, so with two `ssh ro-devbox` tabs open it may pick either. The tmux switch targets the attached client explicitly (`-c <client_tty>`, the first one `list-clients` reports), so it is not iTerm's pick that decides which session moves — but with two attached clients the tab iTerm selects and the client tmux moves can still be different ones.
- A bare Escape is delivered after a ~50 ms debounce, inherent to telling it apart from arrow keys.
- Unrecognized escape sequences (Left/Right, Home, End, function keys) are silently dropped. Both CSI (`\x1b[`) and SS3 (`\x1bO`) forms are consumed to their terminator, so no tail leaks through as literal keystrokes.
