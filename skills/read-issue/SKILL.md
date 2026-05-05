---
name: read-issue
description: Fetch a GitHub issue from the current repo by number and present a structured digest
disable-model-invocation: false
user-invocable: true
argument-hint: "<issue-number>"
allowed-tools: Bash
---

Fetch a GitHub issue from the current repository and present a structured, easy-to-scan digest.

## Steps

1. **Parse argument.**
   - The argument is the issue number (e.g., `564`).
   - If no argument is provided, STOP and ask the user for an issue number.

2. **Detect the current repo.**
   ```bash
   gh repo view --json nameWithOwner -q .nameWithOwner
   ```
   - If the command fails (not a GitHub repo or no remote), STOP and report the error clearly.

3. **Fetch the issue.**
   ```bash
   gh issue view <issue-number> --repo <detected-repo> --json title,body,labels,assignees,state,milestone,comments
   ```

4. **Present a digest** with this structure:
   - **Title** (as a heading)
   - **Metadata line:** Status | Assigned to | Labels | Milestone (if any) | Blocked by (if mentioned)
   - **What:** 1-3 sentence plain-language summary of the issue
   - **Changes needed:** Table or bullet list of files/areas and what needs to happen (if the issue specifies scope)
   - **Key decisions / open questions:** Anything flagged as needing a decision or unresolved
   - **Expected outcome:** What "done" looks like
   - **Comments:** Summarize any comments if present; omit section if none

5. **Keep it concise.** The digest should be scannable in under 30 seconds. Don't parrot the issue body verbatim — synthesize it.

## Rules
- Always detect the repo from the current working directory — never hardcode a repo name.
- If the issue doesn't exist or the `gh` command fails, report the error clearly.
- Do not modify, comment on, or take any action on the issue — read only.
