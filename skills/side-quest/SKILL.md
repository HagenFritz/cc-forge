---
name: side-quest
description: 'Document out-of-scope tasks, technical debt, or related ideas discovered during execution that should be tracked but not immediately addressed. Ties the side-quest to the current issue.'
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
4. If the branch does not contain a clear issue number and it wasn't provided in the prompt, ask the user: "What is the GitHub/Linear issue number this relates to?"
5. Scan `docs/brainstorms/`, `docs/plans/`, or `docs/ideate/` for any recent documents that relate to this issue or current context.

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

Use the Write tool to save the side-quest document to the path determined in Phase 1.

Confirm to the user:
```text
Side-quest documented at `docs/side-quests/[filename]`.
```

## Phase 3: Next Steps

Ask the user: "Side-quest saved. Ready to return to your main task?"
