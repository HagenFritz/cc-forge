---
name: toggl-start
description: Start a Toggl Track timer for the current GitHub issue or task. Use when beginning work on an issue or task to start time tracking.
disable-model-invocation: false
user-invocable: true
argument-hint: "[issue-number or description] [--project <name>] [--no-project]"
allowed-tools: Bash
---

Start a Toggl timer for the current task by running:

```bash
npx toggl-cc@latest start $ARGUMENTS
```

## Arguments
- `[issue-number]` - A GitHub issue number (e.g., `123`) to auto-fetch the issue title
- `[description]` - A custom timer description
- `--project <name>` - Link to a specific project (e.g., `--project Frontend`)
- `--no-project` - Explicitly skip project selection

## Examples
- `/toggl-start 123` - Start timer for issue #123, interactive project picker
- `/toggl-start 123 --project Frontend` - Start timer for issue #123 with Frontend project
- `/toggl-start my task --no-project` - Start timer with custom description, no project

Show the output to the user. If the command asks for confirmation (timer already running or project selection), relay the question to the user and pass their answer back.
