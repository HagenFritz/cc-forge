---
name: read-issue
description: Fetch a GitHub issue from ro-compass-web by number and present a structured digest
disable-model-invocation: false
user-invocable: true
argument-hint: "<issue-number>"
allowed-tools: Bash
---

Fetch a GitHub issue from the `rogers-obrien-rad/ro-compass-web` repo and present a structured, easy-to-scan digest.

## Steps

1. **Parse argument.**
   - The argument is the issue number (e.g., `564`).
   - If no argument is provided, STOP and ask the user for an issue number.

2. **Fetch the issue.**
   ```bash
   gh issue view <issue-number> --repo rogers-obrien-rad/ro-compass-web --json title,body,labels,assignees,state,milestone,comments
   ```

3. **Present a digest** with this structure:
   - **Title** (as a heading)
   - **Metadata line:** Status | Assigned to | Labels | Milestone (if any) | Blocked by (if mentioned)
   - **What:** 1-3 sentence plain-language summary of the issue
   - **Changes needed:** Table or bullet list of files/areas and what needs to happen (if the issue specifies scope)
   - **Key decisions / open questions:** Anything flagged as needing a decision or unresolved
   - **Expected outcome:** What "done" looks like
   - **Comments:** Summarize any comments if present; omit section if none

4. **Keep it concise.** The digest should be scannable in under 30 seconds. Don't parrot the issue body verbatim — synthesize it.

## Rules
- Always target repo: `rogers-obrien-rad/ro-compass-web`.
- If the issue doesn't exist or the `gh` command fails, report the error clearly.
- Do not modify, comment on, or take any action on the issue — read only.
