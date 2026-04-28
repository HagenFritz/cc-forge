---
name: stand-up
description: Summarize the past 28h of work (commits, PRs, linked issues) for hagenfritz
disable-model-invocation: false
user-invocable: true
argument-hint: "[optional: since_hours default=28]"
allowed-tools: Bash
---

Generate a concise stand-up summary using the last 28 hours of activity by **hagenfritz** across the current git repo (local commits, unpushed work) and matching GitHub PRs/issues. Group the output by issue for quick readout.

## Steps

1. **Scope and timing.**
   - If an argument is provided, treat it as the hours to look back (default: 28).
   - Ensure you are in the target repo (use `git rev-parse --show-toplevel`). If git is unavailable, stop and ask the user to run inside a repo.

2. **Collect local commit signals (author: hagenfritz).**
   - Run:
     ```bash
     git log --since="<hours> hours ago" --author=hagenfritz --oneline
     ```
   - Capture unpushed work (to avoid missing local-only changes):
     ```bash
     git log --branches --not --remotes --author=hagenfritz --oneline
     ```
   - Capture staged/unstaged changes if relevant:
     ```bash
     git status --short
     ```

3. **Collect PRs updated in the window (author: hagenfritz).**
   - Run (limit to recent):
     ```bash
     gh pr list --author hagenfritz --state all --limit 20 --search "updated:>=$(date -v-<hours>H +%Y-%m-%d)"
     ```
   - For each PR ID from the list, fetch details:
     ```bash
     gh pr view <pr-number> --json number,title,state,mergeable,headRefName,baseRefName,url,updatedAt,labels,reviewDecision
     ```

4. **Pull linked issues (if any).**
   - For each PR body or linked issue number referenced as `#123`, run:
     ```bash
     gh issue view <number> --json number,title,state,labels,url,updatedAt
     ```
   - If no issue is linked, note “No linked issue”.

5. **(Optional) Check CI status for open PRs.**
   - For open PRs, you may fetch checks to flag failures:
     ```bash
     gh pr view <pr-number> --json statusCheckRollup
     ```
   - Summarize pass/fail/queued if available.

6. **Synthesize stand-up summary (concise, grouped by issue).**
   - Group items by linked issue when present. Header format:
     - `#<issue-number> <issue-title> (state)` — include link if available.
   - Under each issue header, include:
     - Commits (oneline, mark unpushed/staged).
     - PRs touching the issue: number/title/state/review/CI, link.
   - For work with no linked issue, put under “Unlinked work”.
   - End with **Follow-ups**: e.g., “Push local commits”, “Update PR #123 after review”, “Add linked issue for Unlinked work”, “Fix failing checks”.
   - Keep it brief; avoid verbosity.

## Rules
- Default lookback is 28h; accept an override in hours.
- If git/gh commands fail, report the failure and stop, rather than guessing.
- Do not fabricate PR/issue links; only report what is found.
- Prefer concise bullets; avoid long paragraphs.
