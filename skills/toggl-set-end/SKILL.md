---
name: toggl-set-end
description: Set a custom end time for the currently running Toggl timer. Use when you need to stop the timer at a specific past time or at the end of the previous entry.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash
---

Set a custom end time for the current timer:

```bash
npx toggl-cc@latest set-end
```

The command will present two options:
1. End at the stop time of the previous entry (useful for bridging gaps between tasks)
2. Specify a custom time (e.g., 14:30 or 2:30pm)

Show the menu and options to the user. Relay their choice back to the command, and then display the final confirmation message.
