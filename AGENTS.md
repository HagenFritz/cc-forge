# CC Forge - Agent Instructions

Personal development workflow plugin with Toggl and GitHub integration.

## Structure

```
.claude-plugin/   Plugin metadata
agents/           Specialized subagents (research, review, workflow)
skills/           Slash commands (SKILL.md files)
```

## Agents

- `research/` - Code research, docs lookup, git history, best practices
- `review/` - Code review specialists (architecture, security, performance, patterns, simplicity, TypeScript, Python)
- `workflow/` - Bug reproduction, linting, PR comments, spec analysis

## Skills

Core workflow: brainstorm -> plan -> work -> review -> compound

- `/ce-brainstorm` - Explore requirements and approaches
- `/ce-plan` - Create implementation plans
- `/ce-work` - Execute work plans
- `/ce-review` - Multi-agent code review
- `/ce-compound` - Document learnings
- `/ce-ideate` - Generate improvement ideas
- `/deepen-plan` - Enhance plans with research
- `/document-review` - Review requirement/plan docs
- `/git-worktree` - Manage git worktrees
- `/frontend-design` - Design-quality frontend code

**GitHub Integration:**
- `/branch` - Create and checkout a branch from an issue number (auto-detects repo)
- `/create-issue-from-context` - Create GitHub issues from conversation context (auto-detects repo)
- `/ship` - Commit changes, push branch, and create a PR (auto-detects repo)

## Agent References in Skills

When referencing agents from within SKILL.md files, use fully-qualified names:
`cc-forge:<category>:<agent-name>` (e.g., `cc-forge:research:best-practices-researcher`)
