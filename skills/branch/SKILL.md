---
name: branch
description: Create and checkout a new branch from an issue number
disable-model-invocation: true
user-invocable: true
argument-hint: [issue-number]
allowed-tools: Bash
---

Create and checkout a new git branch following the naming convention: `{prefix}/{issue-number}/{short-description}`

## Steps

1. **Verify current branch is main.** Run `git rev-parse --abbrev-ref HEAD` and ensure it is `main`.
   - If not on `main`, stop and tell the user they are already on a branch; do not continue.

2. **Update local main.** Run `git pull` to ensure the latest changes are present.

3. **Parse the argument.** `$ARGUMENTS` is the issue number.
   - If no argument is provided or it's empty, use `no-ref` as the issue number and skip to step 5.

4. **Fetch the issue.** Detect `<owner>/<repo>` from `git remote get-url origin`, then run `gh issue view $ARGUMENTS --repo <owner>/<repo>` to get the issue title and description. Use this to determine:
   - The **prefix** (see below)
   - The **short description** (at most 3 words, kebab-case)

5. **If no issue was provided (no-ref)**, ask the user:
   - What is the branch for? (to determine prefix and description)

6. **Determine the prefix** based on the nature of the work:
   - `feat/` — new feature or enhancement
   - `hotfix/` — urgent production fix
   - `bugfix/` — non-urgent bug fix
   - `docs/` — documentation only

7. **Construct the branch name:** `{prefix}/{issue-number}/{short-description}`
   - The description must be at most 3 words, lowercase, hyphen-separated
   - Example: `feat/171/committed-actions`

8. **Create and checkout:** `git checkout -b {branch-name}`

9. Output the new branch name.

## Rules

- Always detect the repository from the current git directory — never hardcode a repo
- Always branch from the current HEAD
- The short description must be at most 3 words
- Use kebab-case for the description
- Do NOT push the branch (that's what /ship is for)
