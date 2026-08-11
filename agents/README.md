# Agents

Specialized subagents the skills dispatch via the `Task` tool. Each is a Markdown file with YAML frontmatter (`name`, `description`, `model`, optional `effort`) and a prompt body. Fully-qualified name: `forge:<category>:<agent-name>`.

Models are pinned per agent using **bare family aliases** (`opus`, `sonnet`, `haiku`) rather than dated model IDs. An alias always resolves to the latest model in its family, so pins track model releases automatically instead of needing a manual bump each generation.

| Agents | Pin |
|---|---|
| all of `review/` except the synthesizer and the adversarial reviewer | `sonnet` — 1M context, opus-level review quality at lower cost |
| `review/review-synthesizer` | `opus` — highest-judgment step in `/deep-review` |
| `review/adversarial-reviewer` | `opus` + `effort: max` — race conditions, TOCTOU, and cascade failures are the fleet's hardest reasoning; runs only on large or sensitive diffs, so the cost is bounded |
| `workflow/lint` | `haiku` — mechanical, fast |
| `research/learnings-researcher` | `sonnet` + `effort: high` — deterministic grep-filter-read pipeline |
| `research/git-history-analyzer` | `sonnet` + `effort: high` — runs prescribed git incantations and summarizes; callers supply the commands |
| `research/repo-research-analyst`, `research/framework-docs-researcher`, `research/best-practices-researcher`, `workflow/spec-flow-analyzer` | `opus` + `effort: high` — `/blueprint`'s research fan-out, whose output gates downstream planning decisions |
| `test/test-plan-critic` | `opus` + `effort: high` — scores every case against the diff and writes a drop list the user acts on |
| `research/issue-intelligence-analyst` | `opus` + `effort: max` — clusters issues by root cause rather than symptom; grounds all of `/ideate`'s fan-out |

No agent uses `inherit`; every model is pinned so a run's cost and quality don't shift with the session model.

Pins are plain frontmatter — edit them if your org's model allowlist differs. Note a pin also applies when *other* skills dispatch the same agent, and it overrides (even downgrades) whatever model the main session runs. `effort` accepts `low`/`medium`/`high`/`xhigh`/`max` and overrides the session effort level.

An alias resolves per-provider, and not every provider is current: on the Anthropic API `opus`→Opus 5 and `sonnet`→Sonnet 5, but `sonnet` resolves to Sonnet 4.6 on Claude Platform on AWS and Sonnet 4.5 on Bedrock and Google Cloud's Agent Platform. Set `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` to override, or `CLAUDE_CODE_SUBAGENT_MODEL` to force every subagent onto one model for a session.

Several were ported from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin), whose stack is Rails/Ruby. The Rails-specific language has been generalized; security and performance reviewers are split into Python and TypeScript variants to match this repo's stack.

## research/

| Agent | Does | Used by |
|-------|------|---------|
| `best-practices-researcher` | External best practices, conventions, implementation guidance for a tech/framework | blueprint, compound, deepen-blueprint |
| `framework-docs-researcher` | Official docs, version constraints, patterns for a framework/library/dependency | blueprint, compound, deepen-blueprint |
| `git-history-analyzer` | Archaeology of git history — why code evolved, who, when | triage-issue, deprecate, deepen-blueprint |
| `issue-intelligence-analyst` | Fetches/analyzes GitHub issues for recurring themes and pain patterns | ideate |
| `learnings-researcher` | Searches `docs/solutions/` for relevant past solutions | blueprint, deep-review, ideate, deepen-blueprint |
| `repo-research-analyst` | Repo structure, conventions, implementation patterns | triage-issue, blueprint, deprecate, deepen-blueprint |

## review/

| Agent | Does | Used by |
|-------|------|---------|
| `security-sentinel-python` | Python security: injection, validation, auth/authz, secrets, OWASP | deep-review, compound, deepen-blueprint |
| `security-sentinel-typescript` | TS/JS security: injection, XSS, validation, auth/authz, secrets, OWASP | deep-review, compound, deepen-blueprint |
| `performance-oracle-python` | Python perf: complexity, ORM/N+1, memory, async, scalability | deep-review, compound, deepen-blueprint |
| `performance-oracle-typescript` | TS/JS perf: complexity, queries, memory, async, bundle/render | deep-review, compound, deepen-blueprint |
| `architecture-strategist` | Pattern compliance, design integrity, cross-boundary effects | deep-review, deepen-blueprint |
| `data-integrity-guardian` | Schema constraints, transaction boundaries, consistency invariants, data lifecycle | compound, deepen-blueprint |
| `correctness-auditor` | Logic bugs, broken contracts, off-by-one, branching, return values | deep-review |
| `reliability-engineer` | Error handling, retries, timeouts, partial failure, background-job robustness | deep-review |
| `adversarial-reviewer` | Abuse cases, race conditions, cascade failures (≥50 lines or sensitive ops) | deep-review |
| `test-coverage-reviewer` | Missing cases, weak assertions, untested branches, flaky patterns in shipped tests | deep-review |
| `pattern-recognition-specialist` | Design patterns, anti-patterns, naming, duplication | compound, deepen-blueprint |
| `code-simplicity-reviewer` | Final pass — YAGNI violations, simplification opportunities | deep-review, compound |
| `review-synthesizer` | Consolidates all reviewer findings into the `docs/reviews/` document (dedupe, severity, groups) | deep-review |
| `python-reviewer` | High-bar Python: Pythonic patterns, type safety, maintainability | _opt-in via `cc-forge.local.md`_ |
| `typescript-reviewer` | High-bar TypeScript: type safety, modern patterns, maintainability | _opt-in via `cc-forge.local.md`_ |

## test/

| Agent | Does | Used by |
|-------|------|---------|
| `test-plan-critic` | Scores a proposed test *plan* in-place (viability + drop list) | test-plan |

## workflow/

| Agent | Does | Used by |
|-------|------|---------|
| `spec-flow-analyzer` | User-flow completeness, edge-case/gap discovery in a spec or plan | blueprint, deepen-blueprint |
| `lint` | Detects and runs the project's linter/formatter/type-checker on changed files | work |

## How `/deep-review` selects reviewers

`/deep-review` does **not** hard-code its review roster. It reads `review_agents` from each project's `cc-forge.local.md` frontmatter, plus an always-run set (correctness, reliability, test-coverage, learnings-researcher) and conditional ones (adversarial on large/sensitive diffs). The `python-reviewer` / `typescript-reviewer` agents are opt-in: a project lists them only if it's a Python/TS codebase. Pick the matching `-python` or `-typescript` variant of the security/performance reviewers per the project's stack.

Synthesis is delegated to `review-synthesizer` — always-run infrastructure dispatched after the reviewers finish, never listed in `review_agents`. It owns the review-doc template and writes the document itself.

## Porting notes

The Rails/upstream cleanup is done:

- `lint` generalized to detect and run the project's own linter/formatter/type-checker (was Ruby+ERB only).
- `security-sentinel` and `performance-oracle` de-Rails'd and split into `-python` / `-typescript` variants.
- `kieran-python-reviewer` / `kieran-typescript-reviewer` renamed to `python-reviewer` / `typescript-reviewer` with the author-persona framing trimmed.
- `bug-reproduction-validator` and `pr-comment-resolver` deleted (no skill dispatched them).
