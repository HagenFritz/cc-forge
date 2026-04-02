---
name: ship
description: Commit all changes per-file, push the branch, and create a PR
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash, Read, Grep, Glob
---

Push the current branch and create a pull request. Also stage and commit any lingering uncommitted changes first.

## Safety Check

1. Run `git rev-parse --show-toplevel` to determine the **current repository root**. All subsequent git operations must be scoped to this repository only.
2. Run `git branch --show-current` to get the current branch name.

**If the current branch is `main` or `master`, STOP immediately** and tell the user:
> "You're on the main branch. Please check out a feature branch first before using /ship. Try using /branch"

Do NOT proceed with any commits or pushes on main/master.

## Steps

### Phase 1: Handle uncommitted changes (skip if working tree is clean)

1. Run `git status` to identify any modified, deleted, or untracked files (never use `-uall` flag).
2. **Filter files to current repo only**: Only process files that are within the current repository root (from Safety Check step 1). Ignore any files in other repositories.
3. If there are uncommitted changes **in the current repo**:
   - Run `git diff` to understand the changes across all files.
   - Run `git log --oneline -5` to understand the repo's commit message style.
   - **Analyze and group changes logically**:
     - Group files that belong to the same logical change (e.g., all files for "add billing goals API" or "fix authentication bug")
     - Consider grouping by: feature, bugfix, refactor, or area of concern
     - Avoid overly granular (one file per commit) or overly broad (all changes in one commit) groupings
   - For **each logical group**, in order of dependency:
     - `git add <file1> <file2> ...` (all files in the group)
     - `git commit` with a concise message describing the logical change. Follow the repo's existing commit style.
     - End each commit message with: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
   - **Example groupings**:
     - Backend API changes (route + service + model) → one commit
     - Frontend component changes (component + styles + types) → one commit
     - Documentation updates → separate commit
     - Config/infrastructure changes → separate commit
4. **Detect changes in other repos**: If `git status` or file inspection shows changes in other repository directories (outside current repo root), note this for the PR body but do NOT commit or push those changes.

### Phase 2: Understand the full branch

5. Run `git log --oneline main..HEAD` to see all commits on this branch.
6. Run `git diff main...HEAD` to see the full diff of the branch against main.
7. Read through the diff carefully — this is what informs the PR title and body.

### Phase 3: Push and create PR

8. Push the branch to the remote with `git push -u origin <branch-name>`.
9. Detect `<owner>/<repo>` from `git remote get-url origin`.
10. Create a PR using `gh pr create` with:
   - A concise title (under 70 chars) summarizing the branch's changes **in the current repo** based on the full diff and commit history
   - Use the template in [pr-template.md](pr-template.md) for the body format
   - **Primary Changes**: Only include changes from the current repository
   - **Related Changes**: If changes were detected in other repositories (from Phase 1 step 4), add a brief note like "Other repos modified: Changes detected in [repo-name] (not included in this PR)". Do NOT include specific file details or change descriptions from other repos.
   - Use a HEREDOC for the body to ensure correct formatting
11. Output the PR URL.

## Rules

- **Repo scoping**: Only commit and push changes within the current repository root. Never commit changes from other repositories.
- Always detect the repository from the current git directory — never hardcode a repo
- Do NOT use `git add -A` or `git add .`
- Do NOT skip hooks (no `--no-verify`)
- Do NOT push to main/master under any circumstances
- Use a HEREDOC to pass commit messages to git
- If changes exist in other repos, mention them briefly in PR body but provide NO details about those changes
