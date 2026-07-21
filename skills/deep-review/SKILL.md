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
The following paths must never be flagged for deletion, removal, or gitignore by any review agent:

- `docs/brainstorms/*-requirements.md` — Requirements documents created by `/brainstorm`. These are the product-definition artifacts that planning depends on.
- `docs/plans/*.md` — Plan files created by `/plan`. These are living documents that track implementation progress (checkboxes are checked off by `/work`).
- `docs/solutions/*.md` — Solution documents created during the pipeline.

If a review agent flags any file in these directories for cleanup or removal, the review-synthesizer discards that finding during synthesis — always pass this list in its dispatch.
</protected_artifacts>

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
- Task cc-forge:review:correctness-auditor(PR content) - Trace logic, boundaries, and contracts for behavior that doesn't match its claim
- Task cc-forge:review:reliability-engineer(PR content) - Check error handling, timeouts, retries, and partial-failure safety
- Task cc-forge:review:test-coverage-reviewer(PR content) - Judge whether shipped tests would catch a regression of this change
- Task cc-forge:research:learnings-researcher(PR content) - Search docs/solutions/ for past issues related to this PR's modules and patterns

</parallel_tasks>

#### Conditional Agents (Run if applicable):

<conditional_agents>

These agents are run ONLY when the PR matches specific criteria. Check the PR files list to determine if they apply:

**ADVERSARIAL: If the diff is ≥50 lines OR touches shared state, concurrency, auth, or value-bearing operations (payments, credits, redemptions, voting):**

- Task cc-forge:review:adversarial-reviewer(PR content) - Hunt for abuse cases, race conditions, and cascade failures

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

Run the Task cc-forge:review:code-simplicity-reviewer() to see if we can simplify the code.

### 5. Findings Synthesis and Review Document

#### Step 1: Dispatch the Review Synthesizer

Collect the findings from every review agent — including code-simplicity-reviewer (section 4) and the learnings-researcher report — and dispatch a single synthesis task:

```
Task cc-forge:review:review-synthesizer(
  - all review-agent findings, verbatim
  - the learnings-researcher report
  - PR metadata and the branch-or-PR slug
  - protected-artifacts paths
  - cc-forge.local.md review context, if present
  - absolute path of this repo's docs/reviews/ directory
  - today's date
)
```

The synthesizer's Inputs section (`agents/review/review-synthesizer.md`) is the authoritative description of each value — pass the values, not restatements of what they mean. The synthesizer owns the synthesis rules, the review-doc template, and the filename convention (`docs/reviews/YYYY-MM-DD-NNN-<slug>-review.md`); it sanitizes the slug (lowercase, non-`[a-z0-9-]` → `-`, collapse repeats), so a branch like `feat/foo` becomes `feat-foo`. It writes the document itself and returns: the doc path, per-tier counts, the P1/P2 summary rows, the group count, and how many findings it discarded under the protected-artifacts rule. When there are zero findings it writes nothing and returns a clean-review marker (still reporting any discarded count).

The synthesizer is always-run infrastructure — never list it in `review_agents` rosters, and it does not count toward the serial-mode agent threshold.

Before dispatching, persist each review agent's raw returned findings to one deterministic path: `docs/reviews/.raw/<sanitized-slug>/<agent>.md` (same slug sanitization the synthesizer uses). This is the fallback's source of truth — do not rely on in-context memory surviving compaction across the phases between agent dispatch and synthesis. The fallback re-derives this path from the slug, so it works even if the write happened before a compaction. `docs/reviews/.raw/` is gitignored scratch, not a review artifact.

After synthesis, sanity-check the returned counts: kept + discarded + merged-duplicates should roughly equal the raw findings dispatched. A large shortfall signals the payload overflowed the synthesizer's context and findings were silently dropped — on a very large review, dispatch findings in severity-ordered batches (mirroring `--serial`) rather than one oversized call.

#### Step 2: Verify the Review Document

**First, the clean-review case:** if the synthesizer returned the clean-review marker (no `Doc path` to a written file), tell the user the review found no issues and skip the rest of this step — there is no file to verify.

"Dispatch failed" means the Task call returned an error or returned without a `Doc path:` line. (A genuine hang is indistinguishable from slow synthesis in a prose-executed skill — there is no separate hang handling; rely on any session/tool-level timeout.) On failure:

- **Model/spawn rejection** (the model pinned in `review-synthesizer.md` frontmatter is not on the org's allowlist): do NOT retry (a re-spawn with the same model always fails identically). Emit one line naming that pinned model and pointing at `agents/README.md` to repin, then go straight to inline fallback.
- **Any other failure**: retry the dispatch once, then fall inline.

On success, verify the doc rather than trusting the return message:
- Confirm the returned path exists on disk.
- Grep it for the structural anchors `/review-walk` needs: a `## Groups` heading, and at least one `### P<X>-<N>:` heading with `**Status:**` on the line below it. If missing, treat as a failed dispatch.
- Confirm the frontmatter `target:` matches this run's branch/PR and `date:` matches today — guards against a stale same-path doc from an earlier run.
- Re-read the verified file's `## Summary` section as the source of truth for the terminal summary.
- Once the doc passes every check above, delete this run's scratch: `rm -rf docs/reviews/.raw/<sanitized-slug>/`. Only after a verified write — never on the fallback path, which reads from it. The clean-review case keeps its scratch (there is no verified doc to gate on).

**Inline fallback:** read findings from the scratch files at `docs/reviews/.raw/<sanitized-slug>/` (not memory). Then locate the synthesizer's rules/template by trying, in order: (1) read `${CLAUDE_PLUGIN_ROOT}/agents/review/review-synthesizer.md` if that env var resolves to a non-empty path this session; (2) else `"$(git rev-parse --show-toplevel)"/agents/review/review-synthesizer.md`; (3) if neither Read succeeds, present the raw findings to the user grouped by severity rather than exiting with no output. Follow whichever resolved, and state in the terminal summary that the doc was produced by fallback, not the synthesizer.

**Stamp the linked issue:** once the doc has passed every verification check above (the same gate that deleted the scratch), post a stamp on the issue this review's branch/PR is tied to. The clean-review case posts no stamp — there is no doc to reference. A fallback-produced doc never passes this gate, so it posts none either. Issue-number resolution (including the skip when none resolves), posting mechanics, marker encoding, and failure handling are defined in [the issue-log spec](../issue-log/SKILL.md).

```bash
gh issue comment <issue> --repo <owner>/<repo> --body "$(cat <<'EOF'
<!-- cc-forge-log v1: {"skill":"deep-review","event":"review-written","paths":["docs/reviews/<filename>"]} -->

### 🔍 /deep-review — review written

**Findings:** <n> P1 / <n> P2 / <n> P3

| Tier | Count | Issue | Category | Effort |
|------|-------|-------|----------|--------|
| P1   | <n>   | **P1-1: <short title>** — <one-line description> | <category> | <effort> |
| P2   | <n>   | **P2-1: <short title>** — <one-line description> | <category> | <effort> |
| P3   | <n>   | _<n> nice-to-haves: <one-line roll-up of themes> (full detail in the review doc)_ | — | — |
EOF
)"
```

The table is the same one Step 3's terminal summary builds: every P1 and P2 gets its own row (copy them from the review doc's Summary), P3s are one roll-up row — nothing else in the body.

#### Step 3: Summary Report

After verifying the review file, present the terminal summary:

````markdown
## ✅ Code Review Complete

**Review Target:** PR #XXXX - [PR Title] **Branch:** [branch-name]
**Review document:** `docs/reviews/[filename]`

### Findings

| Tier | Count | Issue | Category | Effort |
|------|-------|-------|----------|--------|
| P1   | [n]   | **P1-1: [Short title]** — [one-line description] | [category] | [effort] |
|      |       | **P1-2: [Short title]** — [one-line description] | [category] | [effort] |
| P2   | [n]   | **P2-1: [Short title]** — [one-line description] | [category] | [effort] |
| P3   | [n]   | _[n] nice-to-haves: [one-line roll-up of themes] (full detail in the review doc)_ | — | — |

Every P1 and P2 gets its own row (copy the rows from the review doc's Summary); P3s are one roll-up row. Counts appear once per tier.

Review docs are written under `docs/reviews/`, which is gitignored — they are local working artifacts, not committed repo content. `/review-walk` reads them from the working tree.

### Review Agents Used

- [list only the agents that returned findings this run]
- [if any dispatched agent failed or returned nothing, name it here: "Did not complete: <agent> — coverage for its area is missing"]
- review-synthesizer (synthesis + document)

### Next Steps

1. **Address P1 findings** — critical; must be fixed before merge.
2. **Walk the review** — run `/review-walk docs/reviews/[filename]` to step through issues group-by-group with implement / defer / skip choices. Status updates land in the review doc, so progress is durable.
3. **Remote-review flow** (this machine is not the one that will land the PR — e.g. a review VM): run `/review-walk` here in this same session, then **`/push-review`** — which commits the applied fixes, pushes them onto the PR branch, and posts a PR comment mapping each finding to its outcome (fixed / deferred / skipped). Nothing needs to leave this machine by hand; the review doc stays local (gitignored) and the PR comment carries its context. On the landing machine, run **`/catch-up`** in the worktree to fast-forward and see what arrived, then `/land`.
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

Any **🔴 P1 (CRITICAL)** findings must be addressed before merging the PR. Present these prominently and ensure they're resolved before accepting the PR.
