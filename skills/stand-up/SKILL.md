---
name: stand-up
description: Recap your own work since the previous weekday at 10:00 — merged PRs with their prod status, open PRs, worktrees with no PR yet, docs and PR bodies read for cited facts, and sent mail — on one living Artifact page, then print a four-line stand-up note (Done, Next, Blockers, Notes for the team). Use when the user says "stand-up", "what did I do yesterday", "prep my stand-up", or invokes /stand-up.
user-invocable: true
argument-hint: "[--since <date|datetime>]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/pull.cjs *), Bash(printenv HOME), Read, Write, Agent, Artifact
---

A bundled script does the whole GitHub and git pull; two Haiku readers turn docs, PR bodies and sent mail into cited facts; this context writes the page and the note. Never fetch or infer anything the script or a reader did not return.

Run it from the repo or any of its worktrees. Read-only: the only writes are two scratchpad files, the state file and the Artifact publish.

## 1. Pull

`$ARGUMENTS` is empty or exactly `--since <value>`, where `<value>` is `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` (local). Anything else: print `usage: /stand-up [--since <YYYY-MM-DD | YYYY-MM-DDTHH:MM>]` and stop.

```
node ${CLAUDE_SKILL_DIR}/pull.cjs [--since <value>] --out <scratchpad>/stand-up-pull.json
```

`<scratchpad>` is the session scratchpad directory the system prompt names. On exit 1 or 2, print the script's stderr line and stop. On exit 0, `Read` the whole JSON file (`allow_large` if it is over the read limit).

## 2. Read, in parallel

Send every dispatch below in one message.

**Doc reader, full** — `Agent` with `subagent_type: "forge:research:stand-up-doc-reader"`, one per issue in `issues[]` that has `docs` or PR bodies, at most 8, by `lastActivity` newest first (`null` last). The prompt names mode `full` and passes:
- the issue: `{number, title, branches}` (branches from its worktrees and PRs),
- its `docs` as given,
- its PR bodies: `[{number, title, state, body}]`.

Each issue past the 8th goes to Not read as `over-cap`.

**Doc reader, blockers-only** — one dispatch with mode `blockers-only` and `idle[]` as `[{number, title, docs}]`. Skip it when `idle` is empty.

**Email reader** — `Agent` with `subagent_type: "forge:research:stand-up-email-reader"`, prompt = `window.start` verbatim.

Each reader returns one fenced `json` block. If a dispatch fails to launch, errors, or returns no parseable block:
- a doc reader: every doc it was given goes to Not read as `reader returned nothing`, and none of its facts are used;
- the email reader: Not read gets `email not scanned: <the error>`.

Drop any fact whose `source` is not a doc path or `PR #N` that reader was given (email facts: `source` starts with `email:`). Every reader `notRead` entry goes to Not read.

## 3. Synthesize

Done here, never delegated. The page uses the JSON and the reader facts only.

**References** (page and note): an issue is always `#N (short title)`, a few words cut from its title; a PR always leads with what it does, in words from its body, with `#N` as a link after; an unkeyed item is named by its branch. A bare number is never a reference.

**Citations**: every claim ends in a citation — a PR link, a commit short SHA, a doc path, a stamp's comment `url`, or an email's `source`. Stamp-sourced facts carry the `stamp` tag; a stamp fact that repeats local evidence (a PR, commit or doc already cited) is dropped. Email facts carry the `email` tag.

**Sections**:
- **Done**: own PRs (in `issues[].prs` and `unkeyed[].prs`) with `state: merged` and `deployStatus: "in prod"`, each with its `carriedBy` release PR when set; then email `done-action` facts. A merged PR at `main only` is listed in its issue's detail with the `main only` tag and never called shipped or done.
- **Next**: one sentence starting `inferred from <sources>:`, naming open PRs and in-flight worktree work (unpushed commits, dirty files, no-PR branches).
- **Blockers**: only `blocker`-tagged facts from any reader, each quoting its `sentence`. Empty: `none`. Never CI, review state or merge conflicts.
- **Notes for the team**: only `team-note`-tagged facts whose issue has a PR `in prod`, plus email `team-note` facts. Empty: `none`.
- **In flight, no PR**: each active issue with worktrees and no PR — issue, branch, last commit (subject, short SHA), dirty file count, unpushed commits, then its reader facts. Nothing here is called done.
- **Prod PRs**: one line listing `prodPrs[]` by what each does and its link. Empty: `none`.
- **Detail**: one `.group` per initiative — `initiative.title`, then `No initiative`, then `Unkeyed`, then `Email`. Each issue under its group: its PRs with deploy status, in-window commits, and reader and stamp facts. Email facts whose `issue` matches an issue here sit under it; the rest go in `Email`.
- **Not read**: script `notRead[]`, over-cap issues, reader `notRead` entries, and `email not scanned`. Empty: `none`. A script `warnings[]` entry that means something was not read goes here; the rest print in the terminal only.

Nothing else goes on the page: no window line, no sources line, no definitions, no commentary.

## 4. Fill the page

Copy `${CLAUDE_SKILL_DIR}/page.html` to `<scratchpad>/stand-up.html` and replace each `<!-- slot:… -->` comment with its section. HTML-escape every value taken from the JSON or a reader (`&`, `<`, `>`, `"`). `slot:in-flight` takes `.issue` blocks; `slot:detail` takes one `.group` section per group. Use only these patterns:

```html
<li>Lets a hub site show other sites inside it <a class="cite" href="…/pull/123">#123</a> <span class="tag">in prod</span></li>
<span class="tag">main only</span> <span class="tag">stamp</span> <span class="tag">email</span>
<span class="none">none</span>
<span class="path">/abs/path/doc.md</span>  <code>abc1234</code>
<div class="issue"><h3><a href="…/issues/123">#123 (short title)</a></h3><ul>…</ul></div>
<section class="group"><h2>Initiative title</h2> one .issue per issue </section>
```

The template is fixed, so skip the Artifact quickstart.

## 5. Publish the living page

1. Run `printenv HOME`; the state file is `<HOME>/.local/state/cc-forge-stand-up/artifact-url` (`~/.local/state/cc-forge-stand-up/artifact-url`).
2. `Read` it. If it holds a URL, call `Artifact` with `action: "read"` and that `url`, then publish with `url` and `file_path: <scratchpad>/stand-up.html`. No `icon` on a republish.
3. If the file is missing or empty, or the read says the artifact is gone or not found, publish new with `file_path`, `icon: "calendar"` and a one-sentence `description`, then `Write` the new URL alone to the state file (Write creates the directory).

## 6. Print

Exactly this, nothing else:

```
Window: <startWeekday> <start date HH:MM> → <endWeekday> <end date HH:MM> (<default | --since>)
Done: …
Next (inferred from …): …
Blockers: …
Notes for the team: …
<page URL>
```

Each note line is one sentence or less and the four read aloud in under 30 seconds: Done names at most three items, then `and N more`. Empty Blockers or Notes print `none`. After the URL, print each remaining script warning on its own line.
