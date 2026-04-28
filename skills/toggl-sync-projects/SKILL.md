---
name: toggl-sync-projects
description: Fetch and cache your Toggl projects locally so they are available when starting timers. Run this once after install, and again whenever your projects change.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash
---

Fetch and cache Toggl projects:

```bash
npx toggl-cc@latest sync-projects
```

Show the output to the user.
