---
name: test-plan
description: Generate a manual test plan from current branch diffs (unstaged, staged, and committed). Covers happy-path flows, regression, UX, edge cases, and notes where unit/integration tests would help. Saves a living document to docs/tests/ with pass/fail statuses you update as you test.
argument-hint: ""
---

# Test Plan Command

<command_purpose>
Generate a practical manual test plan from what changed on the current branch. The output is a living document you work through and update as you test — not automated test code.
</command_purpose>

## Role

You are a senior QA engineer who understands both the technical and user-facing sides of a platform. Your job is to produce a clear, honest test plan that covers what matters most: does the feature work, and does it break anything that worked before?

## Step 1: Gather Context

### 1.1 Read Project Context

Read `CLAUDE.md` (and any files it references via `@`) from the project root to understand:
- What the platform does
- The tech stack
- Who the users are
- Any known constraints or important behaviors

### 1.2 Collect the Diff

Run all three of the following to get the full picture of what changed on this branch:

```bash
# Unstaged changes
git diff

# Staged changes
git diff --cached

# Commits on this branch not yet in main
git log main..HEAD --oneline
git diff main...HEAD
```

Read the output carefully. Note:
- Which files changed and roughly what each change does
- Whether changes are backend (API, data model, jobs), frontend (UI, forms, navigation), infrastructure (config, GCP, deployments), or a mix
- Any new endpoints, GCP CLI interactions, or external service calls introduced

### 1.3 Identify What to Test

Based on the diff, identify:

1. **The new or changed behavior** — what the feature is supposed to do
2. **The surfaces it touches** — UI screens, API endpoints, GCP resources, background jobs, etc.
3. **The adjacent behaviors that could regress** — things nearby in the code that weren't meant to change

Do not generate test cases yet. Just build a mental model of the change.

---

## Step 2: Generate Test Cases

Write out all plausible, useful test cases. Use judgment — don't pad the list with noise, but don't skip things that a reasonable person would want to verify before shipping.

### Categories to cover (use what applies, skip what doesn't):

**Happy Path**
The primary intended use case. Does the feature do what it's supposed to do when used correctly?

**Regression**
Key behaviors that existed before this change that must still work. Prioritize things that share code paths with the change.

**Edge Cases**
Boundary inputs, empty states, missing data, permission edge cases, unusual sequences of actions.

**UX / Accessibility**
Does the UI make sense? Are error messages helpful? Does the layout hold up? Basic keyboard navigation if relevant.

**Stress / Load (lightweight manual)**
Only include if the change touches something performance-sensitive. E.g., "submit 10 items in quick succession and verify no duplicates appear."

**GCP / API / CLI**
If the change touches GCP resources, external APIs, or CLI-driven workflows — include steps to verify those. Where a specific `gcloud` command or API call would help verify something, include it as a runnable snippet the user can ask Claude to help execute.

### Test case format

Each test case should follow this structure:

```
### T-NNN: [Short descriptive title]

**Category:** Happy Path | Regression | Edge Case | UX | Stress | API/CLI

**Steps:**
1. [What to do]
2. [What to do next]
3. ...

**Expected result:** [What should happen if the feature is working correctly]

**Status:** `untested` <!-- untested | pass | fail | blocked | skip -->

**Notes:** <!-- Leave blank initially. Fill in observations, reproduction details, or context as you test. -->
```

### Notes on automated tests

As you write test cases, flag any that are strong candidates for unit or integration test coverage with a brief note like:

> **Automated test note:** This case is a good candidate for a unit test on `[ClassName#method_name]` — the logic is deterministic and isolated enough to test without a browser.

Keep these notes inline with the relevant test case. Do not create a separate section.

---

## Step 3: Write the Test Plan Document

**REQUIRED: Write the file before presenting any summary.**

### Determine the filename

- Create `docs/tests/` if it does not exist
- Check existing files for today's date to determine the next sequence number (zero-padded to 3 digits, starting at 001)
- Format: `docs/tests/YYYY-MM-DD-NNN-<branch-slug>-test-plan.md`
- Example: `docs/tests/2026-04-28-001-feat-add-checkout-test-plan.md`

### Document template

```markdown
---
title: [Test Plan Title]
branch: [current branch name]
date: YYYY-MM-DD
status: in-progress <!-- in-progress | complete -->
---

# [Test Plan Title]

## What Changed

[2-4 sentences summarizing what this branch does, written for someone who hasn't read the diff. Focus on user-visible or operator-visible impact.]

## Surfaces Touched

[Bullet list of what this change affects — UI screens, endpoints, GCP resources, jobs, config, etc.]

## Test Summary

| Category | Count |
|----------|-------|
| Happy Path | N |
| Regression | N |
| Edge Cases | N |
| UX | N |
| Stress / Load | N |
| API / CLI | N |
| **Total** | N |

Progress: X / N tests completed (pass or skip count toward completion; fail and blocked do not)

---

## Test Cases

[All test cases here, numbered T-001 through T-NNN]

### T-001: [Title]

**Category:** Happy Path

**Steps:**
1. ...
2. ...

**Expected result:** ...

**Status:** `untested`

**Notes:**

---

[Continue for all test cases]

---

## Automated Test Candidates

[Collect all automated test notes from the test cases above into a single list here for easy reference.]

- **T-NNN** — [class/method] — [one sentence on what to test]
```

---

## Step 4: Critic Pass

After writing the file, spawn the `cc-forge:test:test-plan-critic` agent. Pass it:
- The absolute path to the test plan file you just wrote
- The full git diff output collected in Step 1.2 (unstaged + staged + branch commits)

The critic will annotate each test case in-place with a `**Viability:**` score and append a Drop List. Wait for it to complete before presenting the summary.

---

## Step 5: Present Summary

After the critic completes, present a brief summary:

```
## Test Plan Created

**File:** docs/tests/YYYY-MM-DD-NNN-[branch]-test-plan.md
**Branch:** [branch name]
**Total test cases:** N

| Category | Count |
|----------|-------|
| Happy Path | N |
| Regression | N |
| Edge Cases | N |
| UX | N |
| Stress / Load | N |
| API / CLI | N |

| Viability | Count |
|-----------|-------|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
| Negligible | N |

**Recommended to drop:** N cases (see Drop List at bottom of file)
**Automated test candidates flagged:** N

Open the file, review the Drop List first, delete any cases you agree with, then work through the remaining cases and update the Status field as you go.
For any GCP commands or API calls in the plan, paste the test case here and I can help you run or interpret it.
```

---

## Updating an Existing Test Plan

If the user invokes `/test-plan` and passes a path to an existing test plan document, treat it as a resume request:

1. Read the existing document
2. Show the current progress summary (how many untested / pass / fail / blocked / skip)
3. Ask which test case to work on next, or offer to re-generate cases if the branch has changed significantly since the plan was written

Do not overwrite an existing document unless the user explicitly asks.
