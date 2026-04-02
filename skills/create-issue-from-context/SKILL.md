---
name: create-issue-from-context
description: Generate a GitHub issue from conversation context and add it to a project
argument-hint: "[optional framing to guide the issue's focus, used alongside conversation and git context]"
allowed-tools: Bash, AskUserQuestion, Read, TaskCreate, TaskUpdate
---

# Create GitHub Issue from Context

Create a GitHub issue using the current conversation context and git diff/log to auto-generate the title and body. The target repository is always detected from the current git directory.

## Progress Tracking

Before starting, create all tasks upfront using `TaskCreate` so the user can see the full checklist. Mark each task `in_progress` when you start it and `completed` when done. Create these tasks:

1. "Detect repo and check auth" (activeForm: "Detecting repository...")
2. "Gather context and git signals" (activeForm: "Collecting signals...")
3. "Select label and issue type" (activeForm: "Fetching GitHub metadata...")
4. "Generate title and body" (activeForm: "Drafting issue...")
5. "Create issue on GitHub" (activeForm: "Creating issue...")
6. "Add to project" (activeForm: "Adding to project...")

## Steps

1. **Require context or code changes**
   - If there is no prior conversation context **and** no recent git changes, STOP and tell the user they should only invoke this skill from within an active conversation or after inspecting code.
   - Otherwise, gather both: conversation context and git signals.

2. **Detect repository from current directory**
   - Run `git remote get-url origin` and parse `owner/repo` from the URL
   - If not in a git repo or no GitHub remote found, error:
     > "Not in a GitHub repository. Run this from within a git repo with a GitHub remote."
   - Verify `gh auth status` succeeds; if not, error:
     > "GitHub CLI is not authenticated. Run: `gh auth login`"

3. **Collect signals for smart suggestions**
   - **User argument** (if provided): use as a framing lens — it guides the issue's focus, title, and scope but does not replace conversation or git context. All three sources are combined.
   - **Conversation context**: recent discussion summary
   - **Git signals**: run `git status --short` and `git diff --stat` to see touched files; if needed, grab `git diff -U5` for key hunks. If there are recent commits not yet included, use `git log -5 --oneline` to reference the latest changes.
   - If all three sources (argument, conversation, git) are empty, STOP and tell the user to gather more information.
   - Analyze the combined context to suggest the most likely **type** and **label**

4. **Fetch labels and issue types, then prompt for both at once**
   - Fetch both in parallel:
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
   - Use a single `AskUserQuestion` call with two questions so the user sees both and submits once:
     - **Question 1 (Label)**: Show up to 4 most relevant labels based on context analysis, suggested label first
     - **Question 2 (Issue type)**: Show all available types, suggested type first. If no issue types exist on the repo, omit this question.
   - If user provides a label not found in the repo, show error and re-prompt with full list

5. **Generate title and body from signals**
   - Title: under 70 chars, concise, include area/scope (e.g., "chat-v2: new chat button clears URL"), avoid redundancy
   - Do NOT include type or emoji in the title; type will be set separately via GraphQL
   - Body: Use the template format from [issue-template.md](issue-template.md) and fill in each section based on the context and git signals
   - Keep the body concise and low-verbosity
   - If context is thin, ask one clarifying question before proceeding; if still thin, stop and tell the user to gather more context

6. **Create the issue**
   - Create the issue with label (HEREDOC for body):
     ```bash
     gh issue create \
       --repo <owner>/<repo> \
       --title "<title>" \
       --label "<label>" \
       --body "$(cat <<'EOF'
     <LLM-generated body>
     EOF
     )"
     ```
   - Capture the issue number from the output (e.g., extract from URL)
   - Then set the issue type via GraphQL (since `gh issue create` doesn't support types natively):
     - Get the issue's node ID:
       ```bash
       gh api graphql -f query='
       {
         repository(owner: "<owner>", name: "<repo>") {
           issue(number: <issue-number>) { id }
         }
       }'
       ```
     - Set the type using the ID fetched in step 4:
       ```bash
       gh api graphql -f query='
       mutation {
         updateIssue(input: {
           id: "<issue-node-id>",
           issueTypeId: "<type-id>"
         }) {
           issue { number title issueType { name } }
         }
       }'
       ```

7. **Add to project (optional)**
   - Fetch projects live:
     ```bash
     gh project list --owner <owner> --format json --limit 20
     ```
   - If projects exist, use `AskUserQuestion` to prompt:
     > "Select a project to add this issue to:"
     - Show available projects
     - Include a "Skip (don't add to project)" option
   - If project selected:
     ```bash
     gh project item-add <project-number> \
       --owner <owner> \
       --url "$(gh issue view <issue-number> --repo <owner>/<repo> --json url --jq .url)"
     ```
   - If it fails, report the error but still return the issue URL

8. **Output the issue URL, type, and project add status**
    - Show:
      > "Created issue #<number>: <title>"
      > "Type: <type>"
      > "Label: <label>"
      > "Project: <project-name>" (if added)
      > ""
      > "<issue-url>"

## Rules
- Always detect the repository from the current git directory — never use a config file
- Fetch all GitHub metadata (labels, types, projects) live via `gh` CLI
- Use HEREDOC for multi-line bodies
- If project add fails, report the error and provide the issue link
