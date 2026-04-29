---
name: ship
description: Commit all changes per-file, push the branch, and create a PR
user-invocable: true
allowed-tools: Bash, AskUserQuestion, Read, Grep, Glob
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

8. Detect `<owner>/<repo>` from `git remote get-url origin`.

9. **Check for an existing open PR on this branch:**
   Run `gh pr view --json number,url,state 2>/dev/null`. If the command succeeds and `state` is `"OPEN"`:
   - **Update path (PR already exists):**
     - Push the branch: `git push -u origin <branch-name>`
     - Run `git log origin/<branch-name>..HEAD --oneline` to list new commits since the last push.
     - Run `git diff --stat origin/<branch-name>..HEAD` to summarize changed files.
     - Generate a concise comment body with:
       - A short summary sentence describing what was updated
       - A "New commits" list (from the `git log` output)
       - A "Changed files" summary (from `git diff --stat`)
     - Post the comment: `gh pr comment <number> --body "$(cat <<'EOF' ... EOF)"`
     - Output the existing PR URL and stop.
   - If the command fails or `state` is not `"OPEN"` (closed or merged PR), treat as no PR and continue to the new PR path below.

10. **New PR path:**

    a. **Parse the issue number** from the branch name: split the branch name on `/` and take the second segment. If it is a positive integer, store it as `<issue-number>`. Otherwise (non-numeric, `no-ref`, or branch has fewer than two `/`-delimited segments), set `<issue-number>` to none.

    b. **Push the branch**: `git push -u origin <branch-name>`

    c. **Generate PR title and body:**
       - Title: concise (under 70 chars), summarizing the branch's changes in the current repo based on the full diff and commit history.
       - Body: use the template in [pr-template.md](pr-template.md). Substitute `<issue-number>` where the template instructs. If `<issue-number>` is none, omit the bare `#N` line and write "N/A" for the `### Related Issue` section.
       - **Primary Changes**: only changes from the current repository.
       - **Related Changes**: if changes were detected in other repositories (from Phase 1 step 4), add a brief note. Do NOT include specific file or change details from other repos.

    d. **Show confirmation preview** using `AskUserQuestion` with a single question:
       - Set the `preview` field on the **Confirm** option to show the full draft:
         ```
         Title: <title>
         Branch: <branch-name> → main
         Issue: #<issue-number>  (or "No linked issue" if none)

         <full PR body>
         ```
       - Options:
         - **Confirm** (description: "Create this PR as shown") — include the full preview on this option
         - **Cancel** (description: "Abort without creating the PR")
       - Also allow **Other** (automatic) for free-form input.
       - **If Confirm:** proceed to step 10e.
       - **If Cancel:** output "PR creation cancelled. Branch has been pushed to remote." and stop.
       - **If Other:** treat the free-form input as a revised title and/or body revision notes. Regenerate the title and body accordingly and re-show the preview (loop back to step 10d). Repeat until the user confirms or cancels.

    e. **Create the PR:**
       ```
       gh pr create --title "<title>" --body "$(cat <<'EOF'
       <body>
       EOF
       )"
       ```

11. Output the PR URL.

## Rules

- **Repo scoping**: Only commit and push changes within the current repository root. Never commit changes from other repositories.
- Always detect the repository from the current git directory — never hardcode a repo
- Do NOT use `git add -A` or `git add .`
- Do NOT skip hooks (no `--no-verify`)
- Do NOT push to main/master under any circumstances
- Use a HEREDOC to pass commit messages to git
- If changes exist in other repos, mention them briefly in PR body but provide NO details about those changes
