---
name: side-quest
description: 'Document out-of-scope tasks, technical debt, or related ideas discovered during execution that should be tracked but not immediately addressed. Files a labeled GitHub tracking issue and stamps the originating issue.'
argument-hint: "[brief description of the side quest or task]"
---

# Document a Side-Quest

**Note: The current year is 2026.** Use this when dating documents.

`side-quest` captures tasks, tech debt, or improvements discovered while working on a primary issue. It ensures these items are documented safely without derailing the current context.

## Core Principles

1. **Keep it focused** - Document just enough context so you (or someone else) can pick it up later.
2. **Tie to a source of truth** - Every side-quest should reference the original issue it spawned from. If you can tie to a brainstorm, ideate, and/or plan document, do that too. 
3. **Don't fix it now** - The goal of this skill is to unload the mental burden so execution can continue on the main task.

## Interaction Flow

<side_quest_description> #$ARGUMENTS </side_quest_description>

**If the side-quest description above is empty, ask the user:** "What side-quest or technical debt did you discover? Please provide a brief description."

### Context Gathering
1. Check the current git branch by running `git rev-parse --abbrev-ref HEAD`.
2. Extract the issue number from the branch name. The project's branch naming convention is `{prefix}/{issue-number}/{short-description}` (e.g., `feat/123/add-login` -> `123`).
3. If an issue number is successfully extracted, use it automatically.
4. If the branch does not contain a clear issue number and it wasn't provided in the prompt, ask the user: "What is the GitHub/Linear issue number this relates to?" If they answer that there is none, continue without an originating issue — the doc and tracking issue are still created, but Phase 4's stamp is skipped.
5. Run `git remote get-url origin` and parse `<owner>/<repo>` from the URL (needed for Phases 3-4).
6. Scan `docs/brainstorms/`, `docs/plans/`, or `docs/ideate/` for any recent documents that relate to this issue or current context.

## Phase 1: Structure the Document

### Title and File Naming

- Draft a concise, searchable title for the side-quest.
- Build the filename following this convention: `docs/side-quests/YYYY-MM-DD-NNN-issue-[number]-[kebab-case-topic].md`
  - Create `docs/side-quests/` if it does not exist.
  - If creating the directory for the first time, ensure `docs/side-quests/` is added to the project's `.gitignore` file.
  - Check existing files for today's date to determine the next sequence number (zero-padded to 3 digits, starting at 001).
  - Include the issue number (e.g., `issue-123`).
  - Example: `2026-04-06-001-issue-42-fix-pagination-edge-case.md`

### Document Template

Use the following template for the side-quest document:

```markdown
---
date: YYYY-MM-DD
issue: #[number]
branch: <current-branch-name>
topic: <kebab-case-topic>
status: pending
tracking:
---

# <Topic Title>

## Discovery Context
[How was this discovered? What were we working on (Issue #[number]) when this came up?]

**Related Documents:**
- [Path to related brainstorm, plan, or ideate document if found]

## Description
[Clear description of the task, bug, or technical debt.]

## Impact / Why it matters
[Why should we fix this later? What happens if we don't?]

## Implementation Pointers
- **Relevant files:** [List any files, functions, or line numbers involved]
- **Potential approach:** [Brief note on how to solve it, if known]
```

## Phase 2: Write the File

Use the Write tool to save the side-quest document to the path determined in Phase 1. Leave `tracking:` empty — Phase 3 fills it if a tracking issue is created.

Confirm to the user:
```text
Side-quest documented at `docs/side-quests/[filename]`.
```

## Phase 3: File the Tracking Issue

Back the side-quest with a real GitHub issue so it stays visible without local state.

1. Draft the tracking issue:
   - **Title:** the side-quest title from Phase 1.
   - **Body:** the doc's `## Description` section (include `## Impact / Why it matters` when it adds signal).
2. Ask with a single `AskUserQuestion` call:
   - **Question 1:** "File this as a GitHub tracking issue?" — options **Create** (set the `preview` field to the drafted title, label `follow-up`, and body) and **Skip**.
   - **Question 2** (only when an originating issue resolved in Context Gathering): "Does this side-quest depend on the current work (#[number]) landing first?" — options **Yes** / **No**.
3. If the user skips: leave `tracking:` empty and go to Phase 4 — the stamp still posts, covering what exists.
4. If the user confirms, create the issue:
   ```bash
   gh issue create \
     --repo <owner>/<repo> \
     --title "<title>" \
     --label "follow-up" \
     --body "$(cat <<'EOF'
   <Description section from the doc>

   Blocked by <owner>/<repo>#<originating-issue>
   EOF
   )"
   ```
   - Include the `Blocked by` line only when Question 2 was answered **Yes**; omit it otherwise.
   - If the command errors because the `follow-up` label doesn't exist, re-run without `--label` and tell the user the label is missing on this repo.
   - Capture the tracking-issue number from the URL in the output.
5. Update the doc's `tracking:` frontmatter to `<owner>/<repo>#<tracking-issue>` with the Edit tool.
6. Confirm to the user:
   ```text
   Tracking issue created: <issue-url>
   ```

## Phase 4: Stamp the Originating Issue

Skip this phase entirely if no originating issue resolved in Context Gathering (the tracking issue from Phase 3 still stands — there is just nowhere to stamp).

Posting mechanics, marker encoding, confirmation posture, and failure handling are defined in [the issue-log spec](../issue-log/SKILL.md).

```bash
gh issue comment <originating-issue> --repo <owner>/<repo> --body "$(cat <<'EOF'
<!-- cc-forge-log v1: {"skill":"side-quest","event":"side-quest-filed","followup":true,"tracking":"<owner>/<repo>#<tracking-issue>","blocked_by":["<owner>/<repo>#<originating-issue>"]} -->

### 🧭 /side-quest — <short side-quest title>

**Found:** <one line: what was discovered and why it's out of scope for the current work>
**Tracking:** <owner>/<repo>#<tracking-issue>
EOF
)"
```

Adjustments before posting:
- Include `blocked_by` only when the tracking issue's body carries the `Blocked by` line; omit the key otherwise.
- If tracking-issue creation was skipped in Phase 3: omit `"followup":true`, `"tracking"`, and `"blocked_by"` from the marker and drop the `**Tracking:**` line — the stamp records only what exists.

## Phase 5: Next Steps

Ask the user: "Side-quest saved. Ready to return to your main task?"
