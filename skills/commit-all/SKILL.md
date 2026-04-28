---
name: commit-all
description: Stage and commit all unstaged changes with per-file commit messages
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash, Read, Grep, Glob
---

Stage and commit all currently modified/untracked files, creating a **separate commit for each file** with a meaningful commit message.

## Steps

1. Run `git status` to identify all modified, deleted, and untracked files (never use `-uall` flag).
2. Run `git diff` to understand the changes in each file.
3. Run `git log --oneline -5` to understand the repo's commit message style.
4. For **each changed file**, in a logical order:
   - `git add <file>`
   - `git commit` with a concise message describing what changed in that specific file. Follow the repo's existing commit style.
   - Start each commit with one of ["feat: ", "hotfix: ", "bugfix: ", "docs: "] corresponding to the type of change you determine
   - End each commit message with: `Co-Authored-By: Claude <noreply@anthropic.com>`
5. Run `git status` to confirm everything is clean.
6. Summarize all commits made.

## Rules

- Do NOT use `git add -A` or `git add .`
- Do NOT push to any remote
- Do NOT skip hooks (no `--no-verify`)
- If there are no changes, inform the user and stop
- Use a HEREDOC to pass commit messages to git
