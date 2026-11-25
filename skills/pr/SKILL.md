---
name: pr
description: "Commit the branch's uncommitted changes in logical groups, push the branch, and open a PR from cc-forge's template with a pr-created stamp on the linked issue — or, when the branch already has an open PR, push and comment on it with what is new. Zero prompts; stops before any commit on a secret-looking file. Use when the user says 'open a PR', 'push and create a PR', 'make a PR', or invokes /pr."
allowed-tools: Bash, Read, Write, Grep, Glob
---

# PR — Commit, Push, Open or Update a PR

`/pr` takes a feature branch to an open PR with zero prompts — invoking it is the confirmation. It commits what is uncommitted in logical groups, pushes, and either opens a PR from [the template](pr-template.md) or comments on the branch's existing open PR. Every failure stops the run with the error; nothing is retried.

## Phase 1: Preflight

1. Run `git rev-parse --show-toplevel` for the repository root and `git branch --show-current` for `<branch>`. All git operations stay in this repository.
2. **On `main` or `master`, stop** before anything else:
   > "You're on the main branch. Check out a feature branch first with /tree or /branch-from-issue, then re-run /pr."
3. **Secret guard.** List the files `/pr` would commit — modified, staged, and untracked-but-not-ignored, with deletions excluded:
   ```bash
   git diff --name-only --diff-filter=d HEAD
   git ls-files --others --exclude-standard
   ```
   A file is a hit when its basename matches `.env*`, `*.pem`, or `*.key`, or is exactly `credentials`, `credentials.json`, or `.credentials`. Basenames ending in `.example`, `.sample`, or `.template` are exempt. On any hit, stop before any commit, name each file, and give three ways out: add it to `.gitignore`, move it out of the repository, or, if it is meant to be committed, commit it by hand and re-run `/pr` — the guard never looks at committed files. This is a coarse basename check, not a scanner: it never reads file contents, so a secret inside an ordinary file such as `config.json` gets through.

## Phase 2: Commit in logical groups (skip when the tree is clean)

4. Run `git status` (never `-uall`), `git diff`, and `git log --oneline -5` for the repo's commit style.
5. Group the changed files by logical change — a feature, a bugfix, a refactor, or an area of concern — avoiding both one file per commit and everything in one commit. Example groupings:
   - Backend API changes (route + service + model) → one commit
   - Frontend component changes (component + styles + types) → one commit
   - Documentation updates → separate commit
   - Config/infrastructure changes → separate commit
   - Test files written by `/test-plan-run` → grouped with the change they cover, or their own `test:` commit when they cover several
6. For each group, in dependency order: `git add <file1> <file2> ...`, then `git commit` with a concise message in the repo's style, passed through a HEREDOC.

## Phase 3: Understand the branch

7. Run `git fetch origin main` and compare against `origin/main`, never the local `main`. A failed fetch stops the run. Run `git log --oneline origin/main..HEAD`; **when it is empty, stop** before pushing: "Nothing on `<branch>` is ahead of origin/main — no PR to open."
8. Run `git diff origin/main...HEAD` and read it in full; it informs the title, the body, and any update comment.
9. Detect `<owner>/<repo>` from `git remote get-url origin`.

## Phase 4: Update an existing PR

10. Run `gh pr view --json number,url,state`. When it fails or `state` is not `"OPEN"`, go to Phase 5. Otherwise:
    - `git fetch origin <branch>`, then compute what the push will add: `git log --oneline origin/<branch>..HEAD` and `git diff --stat origin/<branch>..HEAD`.
    - `git push -u origin <branch>`. **On rejection** (the remote advanced), stop and report the error. Never pull, rebase, or force, and post no comment.
    - When the commit list is non-empty, write a comment to a temp file with the Write tool — one summary sentence of what was updated, a "New commits" list, and a "Changed files" summary from the diff stat — and post it: `gh pr comment <number> --body-file <temp-file>`. When the list is empty, post nothing.
    - Print the PR URL and stop. No stamp and no Next line.

## Phase 5: Open a new PR

11. **Parse the issue number** from `<branch>`: the second `/`-delimited segment, when it is a positive integer, is `<issue-number>`. Otherwise (non-numeric, `no-ref`, or fewer than two segments) `<issue-number>` is none.
12. `git push -u origin <branch>`. **On rejection**, stop and report the error. Never pull, rebase, or force.
13. **Compose the title and body.**
    - Title: under 70 characters, summarizing the full diff and commit history.
    - Body: fill the fenced skeleton in [pr-template.md](pr-template.md) per that file's instructions. For `### Why`, read the linked issue (`gh issue view <issue-number>`) when there is one, then the conversation, then the diff. Never search for a plan.
14. Write the body to a temp file with the Write tool and create the PR:
    ```bash
    gh pr create --title "<title>" --body-file <temp-file>
    ```
15. Print the PR URL, followed by: Next: `/quick-review` or `/deep-review`, then `/review-sweep`, `/review-walk`, `/review-push`, `/land`.
16. **Post an issue-log stamp on the linked issue** (skip when `<issue-number>` is none). Compose the body below, write it to a temp file with the Write tool, and post per [the issue-log spec](../issue-log/SKILL.md)'s posting rules:
    ```markdown
    <!-- cc-forge-log v1: {"skill":"pr","event":"pr-created","pr":<pr-number>} -->

    ### 🚀 /pr — PR created

    **PR:** <pr-url>
    **Summary:** <one-line summary of the PR>
    ```
    ```bash
    gh issue comment <issue-number> --repo <owner>/<repo> --body-file <temp-file>
    ```

## Rules

- Detect the repository from the current git directory — never hardcode a repo.
- Never `git add -A` or `git add .`.
- Never skip hooks (no `--no-verify`).
- Never push to `main` or `master`.
- Never pull, rebase, or force-push.
- Pass commit messages through a HEREDOC, and PR bodies and comments through `--body-file`.
