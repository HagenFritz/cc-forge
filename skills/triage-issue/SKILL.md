---
name: triage-issue
description: Fetch a GitHub issue and investigate the codebase to determine if it is still present, already fixed, or needs more investigation. Produces a triage document in docs/triage/.
user-invocable: true
argument-hint: "<issue-number>"
allowed-tools: Bash, Agent, Read, Write
---

# Triage Issue

Fetch a GitHub issue and investigate whether it still applies to the codebase.

## Step 1: Parse and Validate

- The argument is the issue number (e.g., `42`).
- If no argument is provided, STOP and ask the user for an issue number.

Detect the repo:

```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

If this fails, STOP and report the error.

## Step 2: Fetch the Issue

```bash
gh issue view <issue-number> --repo <repo> --json title,body,labels,assignees,state,milestone,comments
```

Parse the issue and extract:
- **Title** and **body** summary (1-3 sentences)
- **Key symptoms** — error messages, function names, file paths, behavior described
- **Labels** and **state** (open/closed)

If the issue is already **closed**, note it and continue — a closed issue may still have unmerged fixes or may have been closed prematurely.

## Step 3: Run Parallel Investigation Agents

Spawn two agents in parallel using the Agent tool. Do NOT wait for one before launching the other.

### Agent 1: Codebase Search

```
subagent_type: cc-forge:research:repo-research-analyst

Prompt:
You are triaging GitHub issue #<N>: "<title>"

Issue summary: <2-3 sentence summary of the issue>

Key symptoms / identifiers extracted from the issue:
- <error message or symptom 1>
- <function/class name mentioned>
- <file path or module mentioned>
- etc.

Search the codebase for evidence about whether this issue is still present or has been fixed. Specifically:

1. Grep for the exact error messages, function names, class names, or identifiers from the issue.
2. Read the most relevant files you find — look for the code path described in the issue.
3. Check if there are any TODO/FIXME/HACK comments near the relevant code referencing this issue or symptom.
4. Look for related test files — are there tests that would catch this bug if it regressed?

Report:
- What relevant code you found and where (file:line)
- Whether the code still exhibits the described behavior or has been changed
- Any tests that cover (or conspicuously omit) this area
- Your assessment: does the issue appear STILL PRESENT, FIXED, or UNCLEAR from the code alone
- Confidence: High / Medium / Low
```

### Agent 2: Git History Search

```
subagent_type: cc-forge:research:git-history-analyzer

Prompt:
You are triaging GitHub issue #<N>: "<title>"

Issue summary: <2-3 sentence summary of the issue>

Search the git history for evidence that this issue was addressed. Specifically:

1. Search commit messages for the issue number:
   git log --oneline --all | grep -i "#<N>\|issue.*<N>\|fix.*<N>\|close.*<N>"

2. Search for keywords from the issue title and symptoms:
   git log --oneline --all --grep="<keyword1>" --grep="<keyword2>"

3. If you find relevant commits, examine what changed:
   git show <commit-hash> --stat

4. Check if any open or recently merged PRs reference this issue:
   gh pr list --state all --search "#<N>" --repo <repo> --json number,title,state,mergedAt

Report:
- Any commits or PRs that appear to address this issue (with hashes and dates)
- Whether a fix was merged and approximately when
- Whether the issue was closed by a commit message or PR merge
- Your assessment: does git history suggest the issue is FIXED, STILL OPEN, or UNCLEAR
- Confidence: High / Medium / Low
```

## Step 4: Synthesize Findings

Wait for both agents to complete, then synthesize their reports.

Determine the overall **verdict**:

| Verdict | When to use |
|---|---|
| `fixed` | Both agents agree the issue was resolved — code changed and/or a fix was merged |
| `still-present` | Code still exhibits the described behavior and no fix is evident |
| `likely-fixed` | Git history shows a fix but codebase evidence is ambiguous |
| `likely-present` | Codebase looks unfixed but git history is inconclusive |
| `needs-investigation` | Agents disagree or evidence is too thin to conclude |
| `not-applicable` | Issue describes behavior that no longer exists in the codebase at all (e.g. removed feature) |

Determine **confidence**: High / Medium / Low

- **High** — both agents agree and found direct evidence
- **Medium** — one agent has clear evidence, other is inconclusive
- **Low** — both agents returned inconclusive results or conflicting signals

## Step 5: Write the Triage Document

Ensure `docs/triage/` exists. If it does not exist, create it and add `docs/triage/` to `.gitignore` (appending if the file exists, creating it if not) — triage docs are local investigation artifacts and should not be committed.

Determine the filename:
- Check existing files for today's date to find the next sequence number (zero-padded to 3 digits, starting at 001)
- Format: `docs/triage/YYYY-MM-DD-NNN-issue-<N>-<slug>.md`
- Example: `docs/triage/2026-05-11-001-issue-42-null-pointer-on-checkout.md`

```markdown
---
issue: <N>
title: <issue title>
status: fixed | still-present | likely-fixed | likely-present | needs-investigation | not-applicable
confidence: High | Medium | Low
date: YYYY-MM-DD
repo: <owner/repo>
---

# Triage: #<N> — <Issue Title>

## Issue Summary

<2-3 sentence plain-language summary of what the issue describes>

**State when triaged:** open | closed
**Labels:** <labels or none>

## Verdict

**Status:** `<status>` — **Confidence:** <High | Medium | Low>

<2-3 sentences explaining the verdict. What evidence led to this conclusion? Where does the relevant code live?>

## Evidence

### Codebase Search
<Key findings from Agent 1 — relevant files, what was found, whether code matches the issue description>

### Git History
<Key findings from Agent 2 — relevant commits or PRs, dates, whether a fix was merged>

## Relevant Files

| File | Relevance |
|------|-----------|
| `path/to/file.ext:NN` | <why it matters> |

## Recommended Next Step

<One of the blocks below, based on verdict>
```

**If `still-present` or `likely-present`:**

```markdown
## Recommended Next Step

This issue appears to still be present. Suggested path forward:

→ Run `/brainstorm docs/triage/YYYY-MM-DD-NNN-issue-<N>-<slug>.md` to explore a fix using this triage as context.
```

**If `fixed` or `likely-fixed`:**

```markdown
## Recommended Next Step

This issue appears to have been resolved. If the GitHub issue is still open, you may want to close it:

```bash
gh issue close <N> --repo <owner/repo> --comment "Appears resolved as of <commit or PR reference>. Closing based on triage."
```
```

**If `needs-investigation` or `not-applicable`:**

```markdown
## Recommended Next Step

More investigation is needed. Consider:
- Reproducing the issue manually in a local environment
- Reading the full context of `<most relevant file found>`
- Running `/brainstorm docs/triage/YYYY-MM-DD-NNN-issue-<N>-<slug>.md` to think through next steps
```

## Step 6: Present Summary

After writing the file, present a concise terminal summary:

```
## Triage Complete

**Issue:** #<N> — <title>
**Status:** <status>
**Confidence:** <High | Medium | Low>

<Verdict sentence>

**Triage doc:** docs/triage/YYYY-MM-DD-NNN-issue-<N>-<slug>.md

<One of:>
→ Issue appears fixed. To close: `gh issue close <N> --repo <repo>`
→ Issue still present. Run `/brainstorm docs/triage/...` to explore a fix.
→ Inconclusive. See triage doc for details and suggested next steps.
```

## Rules

- Always detect the repo from the current working directory — never hardcode.
- Never modify, comment on, or take action on the GitHub issue itself unless the user confirms the close command.
- The triage doc is the source of truth — write it before presenting the summary.
- Static analysis cannot be definitive. Always include a confidence level and acknowledge uncertainty when evidence is thin.
