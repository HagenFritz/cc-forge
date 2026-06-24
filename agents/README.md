# Agents

Specialized subagents the skills dispatch via the `Task` tool. Each is a Markdown file with YAML frontmatter (`name`, `description`, `model: inherit`) and a prompt body. Fully-qualified name: `cc-forge:<category>:<agent-name>`.

Several were ported from [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin), whose stack is Rails/Ruby. The Rails-specific language has been generalized; security and performance reviewers are split into Python and TypeScript variants to match this repo's stack.

## research/

| Agent | Does | Used by |
|-------|------|---------|
| `best-practices-researcher` | External best practices, conventions, implementation guidance for a tech/framework | plan, compound, deepen-plan |
| `framework-docs-researcher` | Official docs, version constraints, patterns for a framework/library/dependency | plan, compound, deepen-plan |
| `git-history-analyzer` | Archaeology of git history — why code evolved, who, when | triage-issue, deprecate, deepen-plan |
| `issue-intelligence-analyst` | Fetches/analyzes GitHub issues for recurring themes and pain patterns | ideate |
| `learnings-researcher` | Searches `docs/solutions/` for relevant past solutions | plan, deep-review, ideate, deepen-plan |
| `repo-research-analyst` | Repo structure, conventions, implementation patterns | triage-issue, plan, deprecate, deepen-plan |

## review/

| Agent | Does | Used by |
|-------|------|---------|
| `security-sentinel-python` | Python security: injection, validation, auth/authz, secrets, OWASP | deep-review, compound, deepen-plan |
| `security-sentinel-typescript` | TS/JS security: injection, XSS, validation, auth/authz, secrets, OWASP | deep-review, compound, deepen-plan |
| `performance-oracle-python` | Python perf: complexity, ORM/N+1, memory, async, scalability | deep-review, compound, deepen-plan |
| `performance-oracle-typescript` | TS/JS perf: complexity, queries, memory, async, bundle/render | deep-review, compound, deepen-plan |
| `architecture-strategist` | Pattern compliance, design integrity, cross-boundary effects | deep-review, deepen-plan |
| `data-integrity-guardian` | Schema constraints, transaction boundaries, consistency invariants, data lifecycle | compound, deepen-plan |
| `correctness-auditor` | Logic bugs, broken contracts, off-by-one, branching, return values | deep-review |
| `reliability-engineer` | Error handling, retries, timeouts, partial failure, background-job robustness | deep-review |
| `adversarial-reviewer` | Abuse cases, race conditions, cascade failures (≥50 lines or sensitive ops) | deep-review |
| `test-coverage-reviewer` | Missing cases, weak assertions, untested branches, flaky patterns in shipped tests | deep-review |
| `pattern-recognition-specialist` | Design patterns, anti-patterns, naming, duplication | compound, deepen-plan |
| `code-simplicity-reviewer` | Final pass — YAGNI violations, simplification opportunities | deep-review, compound |
| `python-reviewer` | High-bar Python: Pythonic patterns, type safety, maintainability | _opt-in via `cc-forge.local.md`_ |
| `typescript-reviewer` | High-bar TypeScript: type safety, modern patterns, maintainability | _opt-in via `cc-forge.local.md`_ |

## test/

| Agent | Does | Used by |
|-------|------|---------|
| `test-plan-critic` | Scores a proposed test *plan* in-place (viability + drop list) | test-plan |

## workflow/

| Agent | Does | Used by |
|-------|------|---------|
| `spec-flow-analyzer` | User-flow completeness, edge-case/gap discovery in a spec or plan | plan, deepen-plan |
| `lint` | Detects and runs the project's linter/formatter/type-checker on changed files | work |

## How `/deep-review` selects reviewers

`/deep-review` does **not** hard-code its review roster. It reads `review_agents` from each project's `cc-forge.local.md` frontmatter, plus an always-run set (correctness, reliability, test-coverage, learnings-researcher) and conditional ones (adversarial on large/sensitive diffs). The `python-reviewer` / `typescript-reviewer` agents are opt-in: a project lists them only if it's a Python/TS codebase. Pick the matching `-python` or `-typescript` variant of the security/performance reviewers per the project's stack.

## Porting notes

The Rails/upstream cleanup is done:

- `lint` generalized to detect and run the project's own linter/formatter/type-checker (was Ruby+ERB only).
- `security-sentinel` and `performance-oracle` de-Rails'd and split into `-python` / `-typescript` variants.
- `kieran-python-reviewer` / `kieran-typescript-reviewer` renamed to `python-reviewer` / `typescript-reviewer` with the author-persona framing trimmed.
- `bug-reproduction-validator` and `pr-comment-resolver` deleted (no skill dispatched them).
