---
name: create-initiative
description: Draft an initiative document from context, review it, and generate a parent issue with linked sub-tasks in GitHub
argument-hint: "[optional framing of the initiative's goal]"
allowed-tools: Bash, AskUserQuestion, Read, Write, TaskCreate, TaskUpdate, TaskList
---

# Create Initiative from Context

Draft a markdown document proposing a parent "Initiative" and multiple "Sub-tasks" based on the current conversation, recent ideate/plan documents, and git context. After review, automatically create them in GitHub and link them together.

## Progress Tracking

Before starting, use `TaskList` to clear old tasks. Then create:
1. "Gather context and draft initiative document" (activeForm: "Drafting...")
2. "Review with user" (activeForm: "Waiting for review...")
3. "Fetch GitHub metadata" (activeForm: "Fetching metadata...")
4. "Create parent issue in GitHub" (activeForm: "Creating initiative...")
5. "Create sub-tasks and link" (activeForm: "Creating child issues...")
6. "Add to project" (activeForm: "Adding to project...")

## Phase 1: Gather Context & Draft Document

1. **Gather context:** Combine the user argument, conversation history, recent markdown documents (`docs/brainstorms/`, `docs/plans/`, `docs/ideate/`), and recent git signals (`git status`, `git diff`, `git log`).
2. **Structure the Initiative:** Identify the overarching goal (Parent Issue) and break it down into logical, deliverable chunks (Sub-tasks).
3. **Create the Document:**
   - Ensure the `docs/initiatives/` directory exists. If creating the directory for the first time, ensure `docs/initiatives/` is added to the project's `.gitignore` file.
   - Determine filename: `docs/initiatives/YYYY-MM-DD-NNN-<kebab-case-topic>.md` (check existing files for today's date to determine the zero-padded next sequence number).
   - Write the document using the template from [initiative-template.md](initiative-template.md).
   - Note that the bodies of the subtasks and parent issue should loosely follow the structure in [initiative-issue-template.md](initiative-issue-template.md).

## Phase 2: Review

1. Inform the user the document has been written to `docs/initiatives/<filename>`.
2. Use `AskUserQuestion` to ask: "Initiative drafted at `docs/initiatives/<filename>`. Ready to create the issues in GitHub, or do you want to revise the document first?"
   - Options:
     - **Create Issues** (description: "Proceed to Phase 3")
     - **Revise Document** (description: "Type feedback in 'Other' to regenerate, or manually edit the file first")
     - **Cancel** (description: "Abort without creating")
   - If user cancels, stop.
   - If user provides custom input via Other, treat it as revision notes, regenerate the document, and re-ask.
   - **Crucial:** Wait for the user to confirm "Create Issues" before proceeding. The user may manually edit the document in their IDE during this time.

## Phase 3: GitHub Execution

1. **Detect Repository & Auth:**
   - Run `git remote get-url origin` to parse `<owner>/<repo>`.
   - Verify `gh auth status`.
2. **Fetch Metadata & Prompt for Labels/Types:**
   - Fetch labels and issue types in parallel:
     ```bash
     gh label list --repo <owner>/<repo> --json name,description --limit 100
     ```
     ```bash
     gh api graphql -f query='
     {
       repository(owner: "<owner>", name: "<repo>") {
         issueTypes(first: 20) {
           nodes { id name description }
         }
       }
     }'
     ```
   - Use `AskUserQuestion` to prompt the user:
     - **Parent Issue:** The label is automatically set to `initiative`. Ask the user for the **Issue Type** for the parent issue.
     - **Sub-tasks:** Ask the user to select the **Label** and **Issue Type** for the sub-tasks. (You may ask for them individually or sequentially).
3. **Read Final Document:**
   - Read the finalized markdown document using the `Read` tool to ensure any manual edits by the user are captured.
4. **Create Parent Issue:**
   - Use `gh issue create` to create the Parent issue with the `initiative` label.
   - Capture its issue number (e.g., `#100`) from the output.
   - Set the issue type via GraphQL using the ID fetched earlier.
5. **Create Sub-tasks:**
   - Loop through each Sub-task in the document.
   - Use `gh issue create` for each, using the label(s) specified by the user. Include a reference to the parent in the body: `Part of #<parent_issue_number>\n\n<Description>`.
   - Capture each sub-task's issue number (e.g., `#101`, `#102`).
   - Set the issue type for each via GraphQL.
6. **Link via Task List:**
   - Update the Parent issue to include a GitHub task list of the child issues.
   - Fetch the current body of the parent, append `\n\n### Sub-tasks\n- [ ] #<child_1>\n- [ ] #<child_2>`, and update it using `gh issue edit <parent_number> --body ...`.
7. **Update Document:**
   - Update the `docs/initiatives/` markdown document:
     - Change `status: drafted` to `status: created`.
     - Set `github_issue: #<parent_issue_number>`.

## Phase 4: Add to Project

1. Fetch projects live:
   ```bash
   gh project list --owner <owner> --format json --limit 20
   ```
2. If projects exist, use `AskUserQuestion` to prompt:
   > "Select a project to add this initiative to:"
   - Show available projects. 
   - Do NOT include a "Skip" option - this step is mandatory if projects are found.
3. Add the **Parent Issue** to the selected project using `gh project item-add`.
   ```bash
   gh project item-add <project-number> \
     --owner <owner> \
     --url "$(gh issue view <issue-number> --repo <owner>/<repo> --json url --jq .url)"
   ```
   - Note: If there are errors, report them but proceed.

## Phase 5: Output
- Output a clean summary with the URL to the Parent Issue and a list of all Sub-tasks created.
