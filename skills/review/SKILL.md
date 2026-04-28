---
name: review
description: Perform exhaustive code reviews using multi-agent analysis, ultra-thinking, and worktrees
argument-hint: "[PR number, GitHub URL, branch name, or latest] [--serial]"
---

# Review Command

<command_purpose> Perform exhaustive code reviews using multi-agent analysis, ultra-thinking, and Git worktrees for deep local inspection. </command_purpose>

## Introduction

<role>Senior Code Review Architect with expertise in security, performance, architecture, and quality assurance</role>

## Prerequisites

<requirements>
- Git repository with GitHub CLI (`gh`) installed and authenticated
- Clean main/master branch
- Proper permissions to create worktrees and access the repository
- For document reviews: Path to a markdown file or document
</requirements>

## Main Tasks

### 1. Determine Review Target & Setup (ALWAYS FIRST)

<review_target> #$ARGUMENTS </review_target>

<thinking>
First, I need to determine the review target type and set up the code for analysis.
</thinking>

#### Immediate Actions:

<task_list>

- [ ] Determine review type: PR number (numeric), GitHub URL, file path (.md), or empty (current branch)
- [ ] Check current git branch
- [ ] If ALREADY on the target branch (PR branch, requested branch name, or the branch already checked out for review) → proceed with analysis on current branch
- [ ] If DIFFERENT branch than the review target → offer to use worktree: "Use git-worktree skill for isolated Call `skill: git-worktree` with branch name"
- [ ] Fetch PR metadata using `gh pr view --json` for title, body, files, linked issues
- [ ] Set up language-specific analysis tools
- [ ] Prepare security scanning environment
- [ ] Make sure we are on the branch we are reviewing. Use gh pr checkout to switch to the branch or manually checkout the branch.

Ensure that the code is ready for analysis (either in worktree or on current branch). ONLY then proceed to the next step.

</task_list>

#### Protected Artifacts

<protected_artifacts>
The following paths are compound-engineering pipeline artifacts and must never be flagged for deletion, removal, or gitignore by any review agent:

- `docs/brainstorms/*-requirements.md` — Requirements documents created by `/brainstorm`. These are the product-definition artifacts that planning depends on.
- `docs/plans/*.md` — Plan files created by `/plan`. These are living documents that track implementation progress (checkboxes are checked off by `/work`).
- `docs/solutions/*.md` — Solution documents created during the pipeline.

If a review agent flags any file in these directories for cleanup or removal, discard that finding during synthesis. Do not create a todo for it.
</protected_artifacts>

#### Load Review Agents

Read `compound-engineering.local.md` in the project root. If found, use `review_agents` from YAML frontmatter. If the markdown body contains review context, pass it to each agent as additional instructions.

If no settings file exists, invoke the `setup` skill to create one. Then read the newly created file and continue.

#### Choose Execution Mode

<execution_mode>

Before launching review agents, check for context constraints:

**If `--serial` flag is passed OR conversation is in a long session:**

Run agents ONE AT A TIME in sequence. Wait for each agent to complete before starting the next. This uses less context but takes longer.

**Default (parallel):**

Run all agents simultaneously for speed. If you hit context limits, retry with `--serial` flag.

**Auto-detect:** If more than 5 review agents are configured, automatically switch to serial mode and inform the user:
"Running review agents in serial mode (6+ agents configured). Use --parallel to override."

</execution_mode>

#### Parallel Agents to review the PR:

<parallel_tasks>

**Parallel mode (default for ≤5 agents):**

Run all configured review agents in parallel using Task tool. For each agent in the `review_agents` list:

```
Task {agent-name}(PR content + review context from settings body)
```

**Serial mode (--serial flag, or auto for 6+ agents):**

Run configured review agents ONE AT A TIME. For each agent in the `review_agents` list, wait for it to complete before starting the next:

```
For each agent in review_agents:
  1. Task {agent-name}(PR content + review context)
  2. Wait for completion
  3. Collect findings
  4. Proceed to next agent
```

Always run these last regardless of mode:
- Task cc-forge:review:agent-native-reviewer(PR content) - Verify new features are agent-accessible
- Task cc-forge:research:learnings-researcher(PR content) - Search docs/solutions/ for past issues related to this PR's modules and patterns

</parallel_tasks>

#### Conditional Agents (Run if applicable):

<conditional_agents>

These agents are run ONLY when the PR matches specific criteria. Check the PR files list to determine if they apply:

**MIGRATIONS: If PR contains database migrations, schema.rb, or data backfills:**

- Task cc-forge:review:schema-drift-detector(PR content) - Detects unrelated schema.rb changes by cross-referencing against included migrations (run FIRST)
- Task cc-forge:review:data-migration-expert(PR content) - Validates ID mappings match production, checks for swapped values, verifies rollback safety
- Task cc-forge:review:deployment-verification-agent(PR content) - Creates Go/No-Go deployment checklist with SQL verification queries

**When to run:**
- PR includes files matching `db/migrate/*.rb` or `db/schema.rb`
- PR modifies columns that store IDs, enums, or mappings
- PR includes data backfill scripts or rake tasks
- PR title/body mentions: migration, backfill, data transformation, ID mapping

**What these agents check:**
- `schema-drift-detector`: Cross-references schema.rb changes against PR migrations to catch unrelated columns/indexes from local database state
- `data-migration-expert`: Verifies hard-coded mappings match production reality (prevents swapped IDs), checks for orphaned associations, validates dual-write patterns
- `deployment-verification-agent`: Produces executable pre/post-deploy checklists with SQL queries, rollback procedures, and monitoring plans

</conditional_agents>

### 2. Ultra-Thinking Deep Dive Phases

<ultrathink_instruction> For each phase below, spend maximum cognitive effort. Think step by step. Consider all angles. Question assumptions. And bring all reviews in a synthesis to the user.</ultrathink_instruction>

<deliverable>
Complete system context map with component interactions
</deliverable>

#### Phase 1: Stakeholder Perspective Analysis

<thinking_prompt> ULTRA-THINK: Put yourself in each stakeholder's shoes. What matters to them? What are their pain points? </thinking_prompt>

<stakeholder_perspectives>

1. **Developer Perspective** <questions>

   - How easy is this to understand and modify?
   - Are the APIs intuitive?
   - Is debugging straightforward?
   - Can I test this easily? </questions>

2. **Operations Perspective** <questions>

   - How do I deploy this safely?
   - What metrics and logs are available?
   - How do I troubleshoot issues?
   - What are the resource requirements? </questions>

3. **End User Perspective** <questions>

   - Is the feature intuitive?
   - Are error messages helpful?
   - Is performance acceptable?
   - Does it solve my problem? </questions>

4. **Security Team Perspective** <questions>

   - What's the attack surface?
   - Are there compliance requirements?
   - How is data protected?
   - What are the audit capabilities? </questions>

5. **Business Perspective** <questions>
   - What's the ROI?
   - Are there legal/compliance risks?
   - How does this affect time-to-market?
   - What's the total cost of ownership? </questions> </stakeholder_perspectives>

#### Phase 2: Scenario Exploration

<thinking_prompt> ULTRA-THINK: Explore edge cases and failure scenarios. What could go wrong? How does the system behave under stress? </thinking_prompt>

<scenario_checklist>

- [ ] **Happy Path**: Normal operation with valid inputs
- [ ] **Invalid Inputs**: Null, empty, malformed data
- [ ] **Boundary Conditions**: Min/max values, empty collections
- [ ] **Concurrent Access**: Race conditions, deadlocks
- [ ] **Scale Testing**: 10x, 100x, 1000x normal load
- [ ] **Network Issues**: Timeouts, partial failures
- [ ] **Resource Exhaustion**: Memory, disk, connections
- [ ] **Security Attacks**: Injection, overflow, DoS
- [ ] **Data Corruption**: Partial writes, inconsistency
- [ ] **Cascading Failures**: Downstream service issues </scenario_checklist>

### 3. Multi-Angle Review Perspectives

#### Technical Excellence Angle

- Code craftsmanship evaluation
- Engineering best practices
- Technical documentation quality
- Tooling and automation assessment

#### Business Value Angle

- Feature completeness validation
- Performance impact on users
- Cost-benefit analysis
- Time-to-market considerations

#### Risk Management Angle

- Security risk assessment
- Operational risk evaluation
- Compliance risk verification
- Technical debt accumulation

#### Team Dynamics Angle

- Code review etiquette
- Knowledge sharing effectiveness
- Collaboration patterns
- Mentoring opportunities

### 4. Simplification and Minimalism Review

Run the Task cc-forge:review:code-simplicity-reviewer() to see if we can simplify the code.

### 5. Findings Synthesis, Review Document, and Todo Creation

#### Step 1: Synthesize All Findings

<thinking>
Consolidate all agent reports into a categorized list of findings.
Remove duplicates, prioritize by severity and impact.
</thinking>

<synthesis_tasks>

- [ ] Collect findings from all parallel agents
- [ ] Surface learnings-researcher results: if past solutions are relevant, flag them as "Known Pattern" with links to docs/solutions/ files
- [ ] Discard any findings that recommend deleting or gitignoring files in `docs/brainstorms/`, `docs/plans/`, or `docs/solutions/` (see Protected Artifacts above)
- [ ] Categorize by type: security, performance, architecture, quality, etc.
- [ ] Assign severity levels: 🔴 CRITICAL (P1), 🟡 IMPORTANT (P2), 🔵 NICE-TO-HAVE (P3)
- [ ] Remove duplicate or overlapping findings
- [ ] Estimate effort for each finding (Small/Medium/Large)

</synthesis_tasks>

#### Step 2: Write Review File

**REQUIRED: Write the review file to disk before creating todos or presenting the terminal summary.**

Determine the filename:
- Create `docs/reviews/` if it does not exist
- Check existing files for today's date to determine the next sequence number (zero-padded to 3 digits, starting at 001)
- Format: `docs/reviews/YYYY-MM-DD-NNN-<branch-or-pr-slug>-review.md`
- Examples: `docs/reviews/2026-04-28-001-feat-add-auth-review.md`, `docs/reviews/2026-04-28-002-pr-42-review.md`

Use the Write tool to save the complete review document following this template:

```markdown
---
title: [Review Title]
target: [PR #NNN | branch-name]
date: YYYY-MM-DD
---

# [Review Title]

## Summary

| Priority | Count | Label |
|----------|-------|-------|
| P1 | [n] | Critical — fix before merge |
| P2 | [n] | Important — should fix |
| P3 | [n] | Nice-to-have |
| **Total** | [n] | |

### P1 Issues
[For each P1: `- [ ] **[short title]** — [one sentence description]`]

### P2 Issues
[For each P2: `- [ ] **[short title]** — [one sentence description]`]

### P3 Issues
[For each P3: `- [ ] **[short title]** — [one sentence description]`]

---

## Issues

<!-- Each issue is self-contained — copy a section and paste it into Claude Code to fix. -->

### P1-1: [Short Title]

**Status:** `open` <!-- open | in-progress | done | wont-fix -->

**File(s):** `path/to/file.ext` (line NNN if applicable)

**Problem:** [1-3 sentences. What is wrong, why it matters, what could go wrong if left unfixed.]

**Fix:** [Concrete description of the change needed. Specific enough that Claude Code can act on it without re-investigating. Name the method, pattern, or approach to use. Include the expected behavior after the fix.]

**Effort:** Small | Medium | Large

---

### P2-1: [Short Title]

**Status:** `open` <!-- open | in-progress | done | wont-fix -->

**File(s):** `path/to/file.ext`

**Problem:** [1-3 sentences.]

**Fix:** [Concrete description of the change needed.]

**Effort:** Small | Medium | Large

---

### P3-1: [Short Title]

**Status:** `open` <!-- open | in-progress | done | wont-fix -->

**File(s):** `path/to/file.ext`

**Problem:** [1-2 sentences.]

**Fix:** [Concrete description of the change needed.]

**Effort:** Small | Medium | Large
```

**Issue writing rules:**
- Each issue must be fully self-contained — a reader with no other context should be able to paste it into Claude Code and get a correct fix
- **File(s)** must include exact paths; add line numbers when the finding is pinpointed to a specific location
- **Problem** explains what and why, not just what
- **Fix** describes the concrete change — not just "fix the bug"
- Keep issues tight: no alternatives, pros/cons tables, or acceptance criteria
- Number issues sequentially within each tier: P1-1, P1-2, P2-1, P2-2, P3-1, etc.

#### Step 3: Create Todo Files Using todo-create Skill

<critical_instruction> Use the todo-create skill to create todo files for ALL findings immediately. Do NOT present findings one-by-one asking for user approval. Create all todo files in parallel using the skill, then summarize results to user. </critical_instruction>

**Implementation Options:**

**Option A: Direct File Creation (Fast)**

- Create todo files directly using Write tool
- All findings in parallel for speed
- Use standard template from the `todo-create` skill's [todo-template.md](../todo-create/assets/todo-template.md)
- Follow naming convention: `{issue_id}-pending-{priority}-{description}.md`

**Option B: Sub-Agents in Parallel (Recommended for Scale)** For large PRs with 15+ findings, use sub-agents to create finding files in parallel:

```bash
# Launch multiple finding-creator agents in parallel
Task() - Create todos for first finding
Task() - Create todos for second finding
Task() - Create todos for third finding
etc. for each finding.
```

Sub-agents can:

- Process multiple findings simultaneously
- Write detailed todo files with all sections filled
- Organize findings by severity
- Create comprehensive Proposed Solutions
- Add acceptance criteria and work logs
- Complete much faster than sequential processing

**Execution Strategy:**

1. Synthesize all findings into categories (P1/P2/P3)
2. Group findings by severity
3. Launch 3 parallel sub-agents (one per severity level)
4. Each sub-agent creates its batch of todos using the todo-create skill
5. Consolidate results and present summary

**Process (Using todo-create Skill):**

1. For each finding:

   - Determine severity (P1/P2/P3)
   - Write detailed Problem Statement and Findings
   - Create 2-3 Proposed Solutions with pros/cons/effort/risk
   - Estimate effort (Small/Medium/Large)
   - Add acceptance criteria and work log

2. Use todo-create skill for structured todo management:

   ```bash
   skill: todo-create
   ```

   The skill provides:

   - Template location: the `todo-create` skill's [todo-template.md](../todo-create/assets/todo-template.md)
   - Naming convention: `{issue_id}-{status}-{priority}-{description}.md`
   - YAML frontmatter structure: status, priority, issue_id, tags, dependencies
   - All required sections: Problem Statement, Findings, Solutions, etc.

3. Create todo files in parallel:

   ```bash
   {next_id}-pending-{priority}-{description}.md
   ```

4. Examples:

   ```
   001-pending-p1-path-traversal-vulnerability.md
   002-pending-p1-api-response-validation.md
   003-pending-p2-concurrency-limit.md
   004-pending-p3-unused-parameter.md
   ```

5. Follow template structure from todo-create skill: the `todo-create` skill's [todo-template.md](../todo-create/assets/todo-template.md)

**Todo File Structure (from template):**

Each todo must include:

- **YAML frontmatter**: status, priority, issue_id, tags, dependencies
- **Problem Statement**: What's broken/missing, why it matters
- **Findings**: Discoveries from agents with evidence/location
- **Proposed Solutions**: 2-3 options, each with pros/cons/effort/risk
- **Recommended Action**: (Filled during triage, leave blank initially)
- **Technical Details**: Affected files, components, database changes
- **Acceptance Criteria**: Testable checklist items
- **Work Log**: Dated record with actions and learnings
- **Resources**: Links to PR, issues, documentation, similar patterns

**File naming convention:**

```
{issue_id}-{status}-{priority}-{description}.md

Examples:
- 001-pending-p1-security-vulnerability.md
- 002-pending-p2-performance-optimization.md
- 003-pending-p3-code-cleanup.md
```

**Status values:**

- `pending` - New findings, needs triage/decision
- `ready` - Approved by manager, ready to work
- `complete` - Work finished

**Priority values:**

- `p1` - Critical (blocks merge, security/data issues)
- `p2` - Important (should fix, architectural/performance)
- `p3` - Nice-to-have (enhancements, cleanup)

**Tagging:** Always add `code-review` tag, plus: `security`, `performance`, `architecture`, `rails`, `quality`, etc.

#### Step 4: Summary Report

After writing the review file and creating all todo files, present comprehensive summary:

````markdown
## ✅ Code Review Complete

**Review Target:** PR #XXXX - [PR Title] **Branch:** [branch-name]
**Review document:** `docs/reviews/[filename]`

### Findings Summary:

- **Total Findings:** [X]
- **🔴 CRITICAL (P1):** [count] - BLOCKS MERGE
- **🟡 IMPORTANT (P2):** [count] - Should Fix
- **🔵 NICE-TO-HAVE (P3):** [count] - Enhancements

### Created Todo Files:

**P1 - Critical (BLOCKS MERGE):**

- `001-pending-p1-{finding}.md` - {description}
- `002-pending-p1-{finding}.md` - {description}

**P2 - Important:**

- `003-pending-p2-{finding}.md` - {description}
- `004-pending-p2-{finding}.md` - {description}

**P3 - Nice-to-Have:**

- `005-pending-p3-{finding}.md` - {description}

### Review Agents Used:

- kieran-rails-reviewer
- security-sentinel
- performance-oracle
- architecture-strategist
- agent-native-reviewer
- [other agents]

### Next Steps:

1. **Address P1 Findings**: CRITICAL - must be fixed before merge

   - Review each P1 todo in detail
   - Implement fixes or request exemption
   - Verify fixes before merging PR

2. **Triage All Todos**:
   ```bash
   ls .context/compound-engineering/todos/*-pending-*.md todos/*-pending-*.md 2>/dev/null  # View all pending todos
   /todo-triage             # Use slash command for interactive triage
   ```

3. **Work on Approved Todos**:

   ```bash
   /todo-resolve  # Fix all approved items efficiently
   ```

4. **Track Progress**:
   - Rename file when status changes: pending → ready → complete
   - Update Work Log as you work
   - Commit review findings and status updates

### Severity Breakdown:

**🔴 P1 (Critical - Blocks Merge):**

- Security vulnerabilities
- Data corruption risks
- Breaking changes
- Critical architectural issues

**🟡 P2 (Important - Should Fix):**

- Performance issues
- Significant architectural concerns
- Major code quality problems
- Reliability issues

**🔵 P3 (Nice-to-Have):**

- Minor improvements
- Code cleanup
- Optimization opportunities
- Documentation updates
````

### 6. End-to-End Testing (Optional)

<detect_project_type>

**First, detect the project type from PR files:**

| Indicator | Project Type |
|-----------|--------------|
| `*.xcodeproj`, `*.xcworkspace`, `Package.swift` (iOS) | iOS/macOS |
| `Gemfile`, `package.json`, `app/views/*`, `*.html.*` | Web |
| Both iOS files AND web files | Hybrid (test both) |

</detect_project_type>

<offer_testing>

After presenting the Summary Report, offer appropriate testing based on project type:

**For Web Projects:**
```markdown
**"Want to run browser tests on the affected pages?"**
1. Yes - run `/test-browser`
2. No - skip
```

**For iOS Projects:**
```markdown
**"Want to run Xcode simulator tests on the app?"**
1. Yes - run `/xcode-test`
2. No - skip
```

**For Hybrid Projects (e.g., Rails + Hotwire Native):**
```markdown
**"Want to run end-to-end tests?"**
1. Web only - run `/test-browser`
2. iOS only - run `/xcode-test`
3. Both - run both commands
4. No - skip
```

</offer_testing>

#### If User Accepts Web Testing:

Spawn a subagent to run browser tests (preserves main context):

```
Task general-purpose("Run /test-browser for PR #[number]. Test all affected pages, check for console errors, handle failures by creating todos and fixing.")
```

The subagent will:
1. Identify pages affected by the PR
2. Navigate to each page and capture snapshots (using Playwright MCP or agent-browser CLI)
3. Check for console errors
4. Test critical interactions
5. Pause for human verification on OAuth/email/payment flows
6. Create P1 todos for any failures
7. Fix and retry until all tests pass

**Standalone:** `/test-browser [PR number]`

#### If User Accepts iOS Testing:

Spawn a subagent to run Xcode tests (preserves main context):

```
Task general-purpose("Run /xcode-test for scheme [name]. Build for simulator, install, launch, take screenshots, check for crashes.")
```

The subagent will:
1. Verify XcodeBuildMCP is installed
2. Discover project and schemes
3. Build for iOS Simulator
4. Install and launch app
5. Take screenshots of key screens
6. Capture console logs for errors
7. Pause for human verification (Sign in with Apple, push, IAP)
8. Create P1 todos for any failures
9. Fix and retry until all tests pass

**Standalone:** `/xcode-test [scheme]`

### Important: P1 Findings Block Merge

Any **🔴 P1 (CRITICAL)** findings must be addressed before merging the PR. Present these prominently and ensure they're resolved before accepting the PR.
