# Agents

Specialized subagents the skills dispatch via the `Task` tool. Each is a Markdown file with YAML frontmatter (`name`, `description`, `model`, optional `effort`) and a prompt body. Fully-qualified name: `forge:<category>:<agent-name>`.

Models are pinned per agent using **bare family aliases** (`opus`, `sonnet`, `haiku`) rather than dated model IDs. An alias always resolves to the latest model in its family, so pins track model releases automatically instead of needing a manual bump each generation.

| Agents | Pin |
|---|---|
| all of `review/` except the synthesizer and the adversarial reviewer | `sonnet` — 1M context, opus-level review quality at lower cost |
| `review/review-synthesizer` | `opus` — highest-judgment step in `/deep-review` |
| `review/adversarial-reviewer` | `opus` + `effort: high` — race conditions, TOCTOU, and cascade failures are the fleet's hardest reasoning; runs only on large or sensitive diffs, so the cost is bounded |
| `workflow/lint` | `haiku` — mechanical, fast |
| `workflow/scope-observer` | `sonnet` — compares one unit's diff to its plan fields after every unit; flags and never acts, so the judgment cost stays small |
| `research/learnings-researcher` | `sonnet` + `effort: high` — deterministic grep-filter-read pipeline |
| `research/git-history-analyzer` | `sonnet` + `effort: high` — runs prescribed git incantations and summarizes; callers supply the commands |
| `research/repo-research-analyst`, `research/framework-docs-researcher`, `research/best-practices-researcher`, `workflow/spec-flow-analyzer` | `opus` + `effort: high` — `/blueprint`'s research fan-out, whose output gates downstream planning decisions |
| `test-plan/spec-lens`, `test-plan/blast-radius-lens`, `test-plan/surface-lens` | `sonnet` — three parallel proposers; each reads one slice of the change and writes no file, so the judgment cost sits downstream |
| `test-plan/test-synthesizer` | `opus` + `effort: high` — scores every proposed case, applies the keep and drop rules, and writes a drop list the user acts on |
| `test-plan/test-writer` | `opus` + `effort: high` — writes real test code from the stated behavior alone, with no view of the implementation to copy from |
| `research/issue-intelligence-analyst` | `opus` + `effort: high` — clusters issues by root cause rather than symptom; grounds all of `/ideate`'s fan-out |

No agent uses `inherit`; every model is pinned so a run's cost and quality don't shift with the session model.

Pins are plain frontmatter — edit them if your org's model allowlist differs. Note a pin also applies when *other* skills dispatch the same agent, and it overrides (even downgrades) whatever model the main session runs. `effort` accepts `low`/`medium`/`high`/`xhigh`/`max` and overrides the session effort level.

`tools:` is an optional frontmatter field naming the exact tools an agent may use. Omit it and the agent inherits every tool available to subagents; list tools and it gets only those. Five agents restrict it, and in every case the restriction is the design rather than a precaution — an agent that cannot reach something cannot be talked into reaching it:

| Agent | `tools:` | Why |
|---|---|---|
| `review/review-synthesizer` | `Read, Write, Glob, Grep` | consolidates findings and writes one document; it has no reason to run commands |
| `test-plan/test-synthesizer` | `Read, Write, Glob, Grep` | same shape — reads lens output, writes one document |
| `test-plan/test-writer` | `Read, Write, Glob, Grep` | **no `Bash`**, so it cannot `git diff`, `git log -p`, or `cat` an implementation file. The outside-observer wall depends on this, and the orchestrator runs every test itself |
| `test-plan/surface-lens` | `Read, Glob, Grep, Bash` | reads the changed UI paths; no `Write`, because a lens proposes and never edits |
| `workflow/scope-observer` | `Read, Glob, Grep, Bash` | reads the diff and the plan; **no `Write` or `Edit`**, so a deviation card is all it can produce — it never fixes, reverts, or gates |

`test-plan/spec-lens` is the one agent that must reach **no file tools at all** — it proposes test cases from the stated intent, so seeing the repo would defeat it. `tools:` cannot express that, so the shape is `disallowedTools:`:

```yaml
disallowedTools: Read, Glob, Grep, Bash, Edit, Write, NotebookEdit, Agent, Skill, ToolSearch, WebFetch, WebSearch
```

`disallowedTools` denies tools out of the inherited pool, in the same comma-separated format as `tools`. When both are set, the deny list is applied first and `tools` is then resolved against what remains; `spec-lens` therefore carries **no `tools:` key** and relies on the deny list alone.

Two shapes that look right and are not. A bare `tools:` with an empty value parses as null, which the loader treats as an **omitted key** — the agent gets all tools, and the plugin listing reports `(Tools: All tools)` while the file reads as if it granted none. An explicit `tools: []` is worse than useless: a tool list that resolves to nothing makes the `Agent` tool refuse to launch the subagent at all.

`Agent` is on the deny list so the lens cannot spawn a subagent holding the tools it lacks; `Skill` because invoking a skill loads its `SKILL.md` and any template or asset file it references; `ToolSearch` because it surfaces the schemas of deferred tools, including MCP tools with file or browser reach; and the web tools so the lens cannot fetch the repository from GitHub instead of reading it.

**The deny list holds only for the tools it names.** A grant written as "all tools except these" leaks every capability the list forgot, so the wall is a closed enumeration rather than a property of the agent. MCP tools the session exposes are inherited and are not enumerated, since none of the current ones read this repo; a session that adds an MCP server with repo-read access must add it here. Verify the wall by dispatching the agent and asking it to list its resolved tools — checking that the denied names are absent tests the wrong half.

An alias resolves per-provider, and not every provider is current: on the Anthropic API `opus`→Opus 5 and `sonnet`→Sonnet 5, but `sonnet` resolves to Sonnet 4.6 on Claude Platform on AWS and Sonnet 4.5 on Bedrock and Google Cloud's Agent Platform. Set `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` to override, or `CLAUDE_CODE_SUBAGENT_MODEL` to force every subagent onto one model for a session.

Several were ported from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin), whose stack is Rails/Ruby. The Rails-specific language has been generalized; security and performance reviewers are split into Python and TypeScript variants to match this repo's stack.

## research/

| Agent | Does | Used by |
|-------|------|---------|
| `best-practices-researcher` | External best practices, conventions, implementation guidance for a tech/framework | blueprint, compound, blueprint-deepen |
| `framework-docs-researcher` | Official docs, version constraints, patterns for a framework/library/dependency | blueprint, compound, blueprint-deepen |
| `git-history-analyzer` | Archaeology of git history — why code evolved, who, when | triage-issue, deprecate, blueprint-deepen |
| `issue-intelligence-analyst` | Fetches/analyzes GitHub issues for recurring themes and pain patterns | ideate |
| `learnings-researcher` | Searches `docs/solutions/` for relevant past solutions | blueprint, deep-review, ideate, blueprint-deepen |
| `repo-research-analyst` | Repo structure, conventions, implementation patterns | triage-issue, blueprint, deprecate, blueprint-deepen |

## review/

| Agent | Does | Used by |
|-------|------|---------|
| `security-sentinel-python` | Python security: injection, validation, auth/authz, secrets, OWASP | deep-review, compound, blueprint-deepen |
| `security-sentinel-typescript` | TS/JS security: injection, XSS, validation, auth/authz, secrets, OWASP | deep-review, compound, blueprint-deepen |
| `performance-oracle-python` | Python perf: complexity, ORM/N+1, memory, async, scalability | deep-review, compound, blueprint-deepen |
| `performance-oracle-typescript` | TS/JS perf: complexity, queries, memory, async, bundle/render | deep-review, compound, blueprint-deepen |
| `architecture-strategist` | Pattern compliance, design integrity, cross-boundary effects | deep-review, blueprint-deepen |
| `data-integrity-guardian` | Schema constraints, transaction boundaries, consistency invariants, data lifecycle | compound, blueprint-deepen |
| `correctness-auditor` | Logic bugs, broken contracts, off-by-one, branching, return values | deep-review |
| `reliability-engineer` | Error handling, retries, timeouts, partial failure, background-job robustness | deep-review |
| `adversarial-reviewer` | Abuse cases, race conditions, cascade failures (≥50 lines or sensitive ops) | deep-review |
| `test-coverage-reviewer` | Missing cases, weak assertions, untested branches, flaky patterns in shipped tests | deep-review |
| `pattern-recognition-specialist` | Design patterns, anti-patterns, naming, duplication | compound, blueprint-deepen |
| `code-simplicity-reviewer` | Final pass — YAGNI violations, simplification opportunities | deep-review, compound |
| `review-synthesizer` | Consolidates all reviewer findings into the `docs/reviews/` document (dedupe, severity, groups) | deep-review |
| `python-reviewer` | High-bar Python: Pythonic patterns, type safety, maintainability | _opt-in via `cc-forge.local.md`_ |
| `typescript-reviewer` | High-bar TypeScript: type safety, modern patterns, maintainability | _opt-in via `cc-forge.local.md`_ |

## test-plan/

| Agent | Does | Used by |
|-------|------|---------|
| `spec-lens` | Proposes black-box behavior cases from the stated intent; **no tools** | test-plan, grind |
| `blast-radius-lens` | Proposes regression cases for adjacent behavior; reads the diff and its call sites | test-plan, grind |
| `surface-lens` | Proposes browser and manual cases from changed UI paths; empty on a backend diff | test-plan, grind |
| `test-synthesizer` | De-dupes, tags, scores, formats revise verdicts, and writes the `docs/tests/` document with its Drop List | test-plan, grind |
| `test-writer` | Writes the `auto` tests from the cases and the public surface; never runs anything | test-plan-run, grind |

## workflow/

| Agent | Does | Used by |
|-------|------|---------|
| `spec-flow-analyzer` | User-flow completeness, edge-case/gap discovery in a spec or plan | blueprint, blueprint-deepen |
| `lint` | Detects and runs the project's linter/formatter/type-checker on changed files | work |
| `scope-observer` | Audits each unit's diff against its plan unit, blind to the worker's account; returns `D1`/`D2`/`D3` deviation cards and checks `Verification` lines at wrap-up | work, grind |

## How `/deep-review` selects reviewers

`/deep-review` does **not** hard-code its review roster. It reads `review_agents` from each project's `cc-forge.local.md` frontmatter, plus an always-run set (correctness, reliability, test-coverage, learnings-researcher) and conditional ones (adversarial on large/sensitive diffs). The `python-reviewer` / `typescript-reviewer` agents are opt-in: a project lists them only if it's a Python/TS codebase. Pick the matching `-python` or `-typescript` variant of the security/performance reviewers per the project's stack.

Synthesis is delegated to `review-synthesizer` — always-run infrastructure dispatched after the reviewers finish, never listed in `review_agents`. It owns the review-doc template and writes the document itself.

## Porting notes

The Rails/upstream cleanup is done:

- `lint` generalized to detect and run the project's own linter/formatter/type-checker (was Ruby+ERB only).
- `security-sentinel` and `performance-oracle` de-Rails'd and split into `-python` / `-typescript` variants.
- `kieran-python-reviewer` / `kieran-typescript-reviewer` renamed to `python-reviewer` / `typescript-reviewer` with the author-persona framing trimmed.
- `bug-reproduction-validator` and `pr-comment-resolver` deleted (no skill dispatched them).
