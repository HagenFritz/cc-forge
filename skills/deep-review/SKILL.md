---
name: deep-review
description: Perform exhaustive multi-agent code reviews with ultra-thinking and worktrees, producing a structured review document
argument-hint: "[PR number, GitHub URL, branch name, or latest] [--serial]"
---

# Review Command

<command_purpose> Perform exhaustive code reviews using multi-agent analysis, ultra-thinking, and Git worktrees for deep local inspection. </command_purpose>

## Introduction

<role>Senior Code Review Architect with expertise in security, performance, architecture, and quality assurance</role>

## Prerequisites

Follow [the review-protocol spec](../review-protocol/SKILL.md#prerequisites) — it owns the baseline every review needs (git repo, authenticated `gh`, clean main/master, a path for document reviews).

This review adds one of its own: permissions to create worktrees and access the repository, since it may offer an isolated checkout.

## Main Tasks

### 1. Determine Review Target & Setup (ALWAYS FIRST)

<review_target> #$ARGUMENTS </review_target>

<thinking>
First, I need to determine the review target type and set up the code for analysis.
</thinking>

#### Immediate Actions:

Follow [the review-protocol spec](../review-protocol/SKILL.md#determining-the-target) — it owns the argument-to-target mapping, the branch check, the PR-metadata fetch, the analysis-tool and security-scanning setup, and the rule that the code on disk must be the code being reviewed before any review agent is dispatched.

This review's working-tree policy is a **worktree offer**: when the current branch is not the review target, offer an isolated checkout — "Use git-worktree skill for isolated Call `skill: git-worktree` with branch name" — or use `gh pr checkout` / a manual checkout to switch. Either way, the code must be ready for analysis (in the worktree or on the current branch) before proceeding.

#### Protected Artifacts

Follow [the review-protocol spec](../review-protocol/SKILL.md#protected-artifacts) — it owns the protected paths and the rule that the synthesizer discards findings against them. Always pass that list in the synthesizer's dispatch.

#### Load Review Agents

Read `cc-forge.local.md` in the project root. If found, use `review_agents` from YAML frontmatter. If the markdown body contains review context, pass it to each agent as additional instructions.

If no settings file exists, use the default agent set (correctness, reliability, test-coverage, learnings-researcher) plus conditional agents (adversarial on large/sensitive diffs).

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
- Task forge:review:correctness-auditor(PR content) - Trace logic, boundaries, and contracts for behavior that doesn't match its claim
- Task forge:review:reliability-engineer(PR content) - Check error handling, timeouts, retries, and partial-failure safety
- Task forge:review:test-coverage-reviewer(PR content) - Judge whether shipped tests would catch a regression of this change
- Task forge:research:learnings-researcher(PR content) - Search docs/solutions/ for past issues related to this PR's modules and patterns

</parallel_tasks>

#### Conditional Agents (Run if applicable):

<conditional_agents>

These agents are run ONLY when the PR matches specific criteria. Check the PR files list to determine if they apply:

**ADVERSARIAL: If the diff is ≥50 lines OR touches shared state, concurrency, auth, or value-bearing operations (payments, credits, redemptions, voting):**

- Task forge:review:adversarial-reviewer(PR content) - Hunt for abuse cases, race conditions, and cascade failures

**When to run:**
- Diff is 50+ lines
- PR touches caching, locks, queues, background jobs, or any shared mutable state
- PR modifies authentication, authorization, or ownership checks
- PR handles money, quotas, rate limits, or any limited/consumable resource

</conditional_agents>

### 2. Ultra-Thinking Deep Dive Phases

<ultrathink_instruction> For each phase below, spend maximum cognitive effort. Think step by step. Consider all angles. Question assumptions. Then hand every review to the synthesizer agent.</ultrathink_instruction>

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

Run the Task forge:review:code-simplicity-reviewer() to see if we can simplify the code.

### 5. Findings Synthesis and Review Document

#### Step 1: Dispatch the Review Synthesizer

This is one linear sequence, and the spec owns every step of it: persist each agent's raw findings to [the scratch path](../review-protocol/SKILL.md#the-raw-findings-scratch-contract), [dispatch the synthesizer](../review-protocol/SKILL.md#dispatching-the-synthesizer) with the inputs it names, then run [its count sanity-check](../review-protocol/SKILL.md#sanity-checking-the-returned-counts) on what comes back.

This review's inputs to that dispatch:

- The findings to collect are those of **every** review agent this run dispatched — including code-simplicity-reviewer (section 4) and the learnings-researcher report.
- Its value for the spec's optional "local review context" input is the markdown body of `cc-forge.local.md`, if present (see [Load Review Agents](#load-review-agents)).
- Because the synthesizer is always-run infrastructure, never list it in `review_agents` rosters, and it does not count toward the serial-mode agent threshold.
- When a very large payload calls for severity-ordered batches, batch them mirroring `--serial`.

#### Step 2: Verify the Review Document

Follow [the review-protocol spec](../review-protocol/SKILL.md#verifying-the-review-document) — it owns the clean-review case, what counts as a failed dispatch, the model-rejection-versus-retry split, every structural and freshness check on the written doc, and the scratch deletion gated on those checks passing. When it falls through, follow [its inline fallback](../review-protocol/SKILL.md#inline-fallback).

**Stamp the linked issue:** follow [the review-protocol spec](../review-protocol/SKILL.md#the-review-written-stamp) — it owns when the `review-written` stamp fires (and the clean-review and fallback cases that post none), the shared body below the marker heading, and the posting command. This review's filled template:

```markdown
<!-- cc-forge-log v1: {"skill":"deep-review","event":"review-written","paths":["docs/reviews/<filename>"]} -->

### 🔍 /deep-review — review written
```

#### Step 3: Summary Report

Follow [the review-protocol spec](../review-protocol/SKILL.md#the-completion-report) — it owns the terminal summary's template, the one-row-per-P1/P2 rule with the P3 roll-up, and the note that review docs are gitignored working artifacts. Close it with [the spec's next-steps block](../review-protocol/SKILL.md#the-next-steps-block), verbatim.

This review supplies its own `### Review Agents Used` section, between the Findings table and Next Steps ([the spec](../review-protocol/SKILL.md#the-review-agents-used-section) leaves its content to each review):

```markdown
### Review Agents Used

- [list only the agents that returned findings this run]
- [if any dispatched agent failed or returned nothing, name it here: "Did not complete: <agent> — coverage for its area is missing"]
- review-synthesizer (synthesis + document)
```

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
Task general-purpose("Run /test-browser for PR #[number]. Test all affected pages, check for console errors, report failures as P1 findings and fix.")
```

The subagent will:
1. Identify pages affected by the PR
2. Navigate to each page and capture snapshots (using Playwright MCP or agent-browser CLI)
3. Check for console errors
4. Test critical interactions
5. Pause for human verification on OAuth/email/payment flows
6. Report any failures as P1 findings
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
8. Report any failures as P1 findings
9. Fix and retry until all tests pass

**Standalone:** `/xcode-test [scheme]`

### Important: P1 Findings Block Merge

Follow [the review-protocol spec](../review-protocol/SKILL.md#important-p1-findings-block-merge) — it owns the rule that P1 findings block the merge and must be presented prominently.
