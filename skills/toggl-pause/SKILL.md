---
name: toggl-pause
description: Pause Toggl timer checks for the current session. The hook will stop reminding you about timers until you run /toggl-start or /toggl-resume.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash
---

Pause Toggl hook checks for this session:

```bash
npx toggl-cc@latest pause
```

Show the output to the user.
