---
name: branch
description: Create and checkout a new branch from an issue number
disable-model-invocation: true
user-invocable: true
argument-hint: <issue-number>
allowed-tools: Bash, AskUserQuestion, TaskCreate, TaskUpdate, TaskList, Skill
---

Create and checkout a new git branch following the naming convention: `{prefix}/{issue-number}/{short-description}`

## Progress Tracking

Before starting, use `TaskList` to find any lingering tasks and delete them all with `TaskUpdate` (status: `deleted`). Then create fresh tasks upfront using `TaskCreate` so the user can see the full checklist. Mark each task `in_progress` when you start it and `completed` when done. Create these tasks:

1. "Check current branch" (activeForm: "Checking branch...")
2. "Sync with remote" (activeForm: "Syncing...")
3. "Fetch issue details" (activeForm: "Fetching issue...")
4. "Construct branch name" (activeForm: "Building branch name...")
5. "Create and checkout branch" (activeForm: "Checking out...")

## Steps

1. **Check current branch.**
   - Run `git rev-parse --abbrev-ref HEAD` to get the current branch.
   - If on `main` or `master`: proceed normally.
   - If on any other branch: use `AskUserQuestion` to warn the user and ask:
     > "You're on `{branch-name}`, not main. Branch from here anyway?"
     - Options: "Yes, branch from here" / "No, cancel"
     - If user cancels, stop.

2. **Sync with remote.**
   - Run `git remote` to check if a remote exists. If none, skip this step.
   - Run `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null` to check if the current branch has an upstream. If it errors or returns nothing, skip this step.
   - If upstream exists, run `git pull`.

3. **Parse the argument.** `$ARGUMENTS` is the issue number.
   - If no argument is provided or it's empty, STOP and tell the user:
     > "An issue number is required. Usage: /branch <issue-number>"

4. **Fetch the issue.**
   - Detect `<owner>/<repo>` from `git remote get-url origin`.
   - Run `gh issue view $ARGUMENTS --repo <owner>/<repo>` to get the issue title and description.
   - Use this to determine the **prefix** and **short description** (2–4 words, kebab-case).

5. **Determine the prefix** based on the nature of the work:
   - `feat/` — new feature or enhancement
   - `bugfix/` — non-urgent bug fix
   - `hotfix/` — urgent production fix
   - `refactor/` — code restructuring without behavior change
   - `chore/` — maintenance, dependencies, config
   - `test/` — adding or updating tests
   - `docs/` — documentation only

6. **Construct the branch name:** `{prefix}/{issue-number}/{short-description}`
   - The description must be 2–4 words, lowercase, hyphen-separated
   - Example: `feat/171/committed-actions`

7. **Check for stale branch.**
   - Run `git branch --list {branch-name}` to see if a branch with that name already exists locally.
   - If it exists, warn the user:
     > "A branch named `{branch-name}` already exists locally."
   - Use `AskUserQuestion` to ask what to do:
     - **Use a different name** (description: "Type a new branch name") — allow Other input
     - **Cancel** (description: "Abort without creating anything")
   - If user provides a different name via Other, use that instead and skip back to the stale check.

8. **Confirm with the user.**
   - Use `AskUserQuestion` to show the proposed branch name and ask:
     > "Ready to create this branch?"
     - Options:
       - **Create it** (description: "Run git checkout -b and switch to the branch")
       - **Cancel** (description: "Abort without creating anything")
     - Also allow "Other" for the user to type a different branch name
   - If user cancels, stop.
   - If user provides a custom name via Other, use that instead.

9. **Create and checkout:** `git checkout -b {branch-name}`

10. **Rename the session** to match the branch name using the `/rename` built-in command:
    - Invoke `/rename {branch-name}` so the session is identifiable when resuming later.

11. **Post a comment on the GitHub issue** with the branch name:
    ```bash
    gh issue comment $ARGUMENTS --repo <owner>/<repo> --body "Branch created: \`{branch-name}\`"
    ```

12. Output the new branch name.

## Rules

- Always detect the repository from the current git directory — never hardcode a repo
- Always branch from the current HEAD
- The short description must be 2–4 words
- Use kebab-case for the description
- Do NOT push the branch (that's what /ship is for)
