# Agents

Specialized subagents dispatched by skills via the `Task` tool. Each is a Markdown file with YAML frontmatter (`name`, `description`, `model`) and a prompt body. Fully-qualified name: `cc-forge:<category>:<agent-name>`. See [README.md](README.md) for the full catalog.

Categories: `research/` (6), `review/` (15), `test/` (1), `workflow/` (2).

Model pins: all of `review/` runs `claude-sonnet-5` except `review-synthesizer` (`claude-opus-4-8`); `workflow/lint` runs `haiku`; everything else inherits the session model.

`/deep-review` loads its reviewer roster from each project's `cc-forge.local.md`, plus an always-run set (correctness, reliability, test-coverage, learnings-researcher) and conditional agents (adversarial on large/sensitive diffs). The `python-reviewer` / `typescript-reviewer` and language-specific security/performance variants are opt-in per project stack. Synthesis is delegated to `review-synthesizer`, always-run and never part of the roster.

Overlapping reviewers (reliability, data-integrity, adversarial) carry explicit scope boundaries in their intros to avoid duplicate findings.

## Related

- **PR #51** (2026-07-13): add the rule of three to pattern-recognition-specialist — duplication is flagged for extraction only at the third occurrence, reconciling its prior second-copy bias with the reviewers' "simple duplication beats DRY" — [plan](docs/plans/2026-07-13-001-feat-rule-of-three-pattern-agent-plan.md)
- **PR #50** (2026-07-09): pin all 14 review agents to claude-sonnet-5 and extract /deep-review synthesis into a dedicated review-synthesizer agent (claude-opus-4-8) that writes the review doc; tier-table summary, dead todo-step removed — [plan](docs/plans/2026-07-09-001-feat-review-model-pins-synthesizer-plan.md)
- **PR #42** (2026-06-24): overhaul review agents — 5 new specialists, security/perf split into python+ts, de-Rails'd, phantom refs removed — closes #41
