@AGENTS.md

## Development Workflow

This is a Claude Code plugin distributed as an npm package. Skills live in `skills/` and agents in `agents/`. The CLI in `src/` copies them to `~/.claude/` on install.

### After changing skills or agents, you MUST install to apply changes

```bash
npm run build && node dist/cli.mjs install
```

Do NOT assume skills are live just because files exist on disk. The install command copies `skills/` and `agents/` to `~/.claude/skills/` and `~/.claude/agents/`. Without running install, changes are only in the working tree and not available to Claude Code.

Always run `npm run build && node dist/cli.mjs install` after modifying any skill or agent file, then tell the user to restart Claude Code for changes to take effect.

### Commands

- `npm run build` — compile TypeScript to `dist/`
- `node dist/cli.mjs install` — copy skills + agents to `~/.claude/`
- `node dist/cli.mjs uninstall` — remove installed skills + agents
- `node dist/cli.mjs doctor` — check installation health
