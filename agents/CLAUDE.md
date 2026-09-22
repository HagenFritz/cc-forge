# Agents

Specialized subagents dispatched by skills via the `Task` tool. Each is a Markdown file with YAML frontmatter (`name`, `description`, `model`, optional `effort`) and a prompt body. Fully-qualified name: `forge:<category>:<agent-name>`. See [README.md](README.md) for the full catalog.

Categories: `research/` (6), `review/` (15), `test/` (5), `workflow/` (2).

Model pins use **bare family aliases** (`opus`, `sonnet`, `haiku`), never dated IDs — an alias tracks the latest model in its family, so pins never go stale and need no manual bumping. Every agent is pinned; none inherit. All of `review/` runs `sonnet` except `review-synthesizer` (`opus`) and `adversarial-reviewer` (`opus` + `max` — the fleet's hardest reasoning, on a conditional agent so the cost stays bounded); `workflow/lint` runs `haiku`; the three `test/` lenses run `sonnet`. The rest carry an explicit `effort`, tiered by whether the work is mechanical or judgment: `sonnet` + `high` for `learnings-researcher` and `git-history-analyzer` (prescribed search-and-summarize); `opus` + `high` for `/blueprint`'s `repo-research-analyst`, `framework-docs-researcher`, `best-practices-researcher`, `spec-flow-analyzer` (output gates downstream decisions), `test-synthesizer` (its drop list deletes tests) and `test-writer` (it writes real test code from the stated behavior alone); `opus` + `max` for `issue-intelligence-analyst` (root-cause clustering that grounds all of `/ideate`'s fan-out). See [README.md](README.md) for the full table.

Caveat: an alias resolves per-provider. On the Anthropic API `opus`→Opus 5 and `sonnet`→Sonnet 5, but on Bedrock and Google Cloud's Agent Platform `sonnet` resolves to Sonnet 4.5. Set `ANTHROPIC_DEFAULT_SONNET_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` if that matters for your provider.

`/deep-review` loads its reviewer roster from each project's `cc-forge.local.md`, plus an always-run set (correctness, reliability, test-coverage, learnings-researcher) and conditional agents (adversarial on large/sensitive diffs). The `python-reviewer` / `typescript-reviewer` and language-specific security/performance variants are opt-in per project stack. Synthesis is delegated to `review-synthesizer`, always-run and never part of the roster.

Overlapping reviewers (reliability, data-integrity, adversarial) carry explicit scope boundaries in their intros to avoid duplicate findings.

`tools:` is the second optional frontmatter field, and in `test/` it is the design rather than a precaution. `spec-lens` must reach no file tools at all, which `tools:` cannot express — a bare `tools:` key parses as null and is treated as omitted (full tools), and `tools: []` makes the `Agent` tool refuse to launch — so it carries no `tools:` key and denies them instead with `disallowedTools: Read, Glob, Grep, Bash, Edit, Write, NotebookEdit, Agent, WebFetch, WebSearch`, `Agent` and the web tools included so it can neither delegate around the wall nor fetch the repo from GitHub. `test-writer` has no `Bash`, so it cannot reach the implementation it is writing tests against; the orchestrator runs every test itself. `surface-lens` reads but never writes. The full table, and the MCP residual, are in [README.md](README.md).

## Related

- **PR #51** (2026-07-13): add the rule of three to pattern-recognition-specialist — duplication is flagged for extraction only at the third occurrence, reconciling its prior second-copy bias with the reviewers' "simple duplication beats DRY" — [plan](docs/plans/2026-07-13-001-feat-rule-of-three-pattern-agent-plan.md)
- **PR #50** (2026-07-09): pin all 14 review agents to claude-sonnet-5 and extract /deep-review synthesis into a dedicated review-synthesizer agent (claude-opus-4-8) that writes the review doc; tier-table summary, dead todo-step removed — [plan](docs/plans/2026-07-09-001-feat-review-model-pins-synthesizer-plan.md)
- **PR #42** (2026-06-24): overhaul review agents — 5 new specialists, security/perf split into python+ts, de-Rails'd, phantom refs removed — closes #41
