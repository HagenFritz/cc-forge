---
name: review-protocol
description: >
  Shared specification for the review skills — deep-review and quick-review. Owns the
  rules both reviews obey identically: review-target resolution, the protected-artifacts
  rule, the synthesizer dispatch, the raw-findings scratch contract, review-document
  verification, the completion report, and the review-written stamp's shared rules. Not
  user-invocable; the reviews cite it and restate none of it.
user-invocable: false
disable-model-invocation: true
---

# Review Protocol Specification (v1)

Two skills review a change with a roster of review agents and a synthesizer, producing a
review document that the downstream consumers read:

| Skill | Roster | Produces |
|---|---|---|
| [`deep-review`](../deep-review/SKILL.md) | configurable, plus conditional agents | `docs/reviews/*.md` |
| [`quick-review`](../quick-review/SKILL.md) | fixed, small | `docs/reviews/*.md` |

This file is the single source of truth for every rule that applies to both of them.
Review skills embed only their own depth-specific prose — which agents run, how they are
selected and dispatched, how much thinking each phase gets, what happens after the
report, and their own filled stamp template — and reference this spec for everything
below. **Never restate a rule from this file inside a review skill**, not even
paraphrased.

Throughout, **the invoking skill** means whichever review is running, and **review
agent** means any agent that skill dispatched to produce findings.

## Prerequisites

- Git repository with GitHub CLI (`gh`) installed and authenticated
- The code on disk is the code being reviewed — however the invoking skill arranges that
- For document reviews: path to a markdown file or document

## Review target resolution

This section covers **deciding what to review** and confirming the code is present to
analyze. It does **not** cover arranging the working tree — creating an isolated
checkout, switching branches, or refusing to move the user is the invoking skill's own
policy, defined there.

### Determining the target

The target comes from the skill's argument: a PR number (numeric), a GitHub URL, a file
path (`.md`), or empty (the current branch).

- [ ] Determine the review type from the argument
- [ ] Check the current git branch
- [ ] If already on the target branch (the PR branch, the requested branch name, or the
      branch already checked out for review) → proceed with analysis on the current
      branch
- [ ] If on a different branch than the review target → hand off to the invoking skill's
      working-tree policy; do not proceed until the target's code is the code on disk
- [ ] Fetch PR metadata with `gh pr view --json` for title, body, files, and linked
      issues
- [ ] Set up whatever analysis tooling this review's roster needs

**Ensure the code being reviewed is the code on disk before dispatching any review
agent.** A review of the wrong tree is worse than no review — it reports confidently on
code that is not the change. Only once that holds does analysis begin.

### Protected artifacts

The following paths must never be flagged for deletion, removal, or gitignore by any
review agent:

- `docs/brainstorms/*-requirements.md` — requirements documents created by
  `/brainstorm`. These are the product-definition artifacts that planning depends on.
- `docs/plans/*.md` — plan files created by `/blueprint`. These are living documents
  that track implementation progress (checkboxes are checked off by `/work`).
- `docs/solutions/*.md` — solution documents created during the pipeline.

If a review agent flags any file in these directories for cleanup or removal, the
review-synthesizer discards that finding during synthesis — **always pass this list in
its dispatch.**

## The raw-findings scratch contract

Before dispatching the synthesizer, persist each review agent's raw returned findings to
one deterministic path:

```
docs/reviews/.raw/<sanitized-slug>/<agent>.md
```

using the same slug sanitization the synthesizer uses. This is the fallback's source of
truth — do not rely on in-context memory surviving compaction across the phases between
agent dispatch and synthesis. The fallback re-derives this path from the slug, so it
works even if the write happened before a compaction.

`docs/reviews/.raw/` is gitignored scratch, not a review artifact.

## Dispatching the synthesizer

Collect the findings from **every review agent this run dispatched** and dispatch a
single synthesis task:

```
Task forge:review:review-synthesizer(
  - all review-agent findings, verbatim
  - PR metadata and the branch-or-PR slug
  - protected-artifacts paths
  - local review context, if the invoking skill has any
  - absolute path of this repo's docs/reviews/ directory
  - today's date
)
```

The synthesizer's Inputs section (`agents/review/review-synthesizer.md`) is the
authoritative description of each value — pass the values, not restatements of what they
mean. The synthesizer owns the synthesis rules, the review-doc template, and the
filename convention (`docs/reviews/YYYY-MM-DD-NNN-<slug>-review.md`); it sanitizes the
slug (lowercase, non-`[a-z0-9-]` → `-`, collapse repeats), so a branch like `feat/foo`
becomes `feat-foo`. It writes the document itself and returns: the doc path, per-tier
counts, the P1/P2 summary rows, the group count, and how many findings it discarded
under the protected-artifacts rule. When there are zero findings it writes nothing and
returns a clean-review marker (still reporting any discarded count).

**The synthesizer is always-run infrastructure** — never list it in a review skill's
agent roster.

### Sanity-checking the returned counts

After synthesis, check the returned counts: kept + discarded + merged-duplicates should
roughly equal the raw findings dispatched. A large shortfall signals the payload
overflowed the synthesizer's context and findings were silently dropped — on a very
large review, split the dispatch into severity-ordered batches rather than one oversized
call — where the invoking skill has a mechanism for it; a review with a small fixed roster
is unlikely to reach that size.

## Verifying the review document

**First, the clean-review case:** if the synthesizer returned the clean-review marker (no
`Doc path` to a written file), tell the user the review found no issues and skip the rest
of this section — there is no file to verify.

"Dispatch failed" means the Task call returned an error or returned without a
`Doc path:` line. (A genuine hang is indistinguishable from slow synthesis in a
prose-executed skill — there is no separate hang handling; rely on any session/tool-level
timeout.) On failure:

- **Model/spawn rejection** (the model pinned in `review-synthesizer.md` frontmatter is
  not on the org's allowlist): do NOT retry — a re-spawn with the same model always fails
  identically. Emit one line naming that pinned model and pointing at `agents/README.md`
  to repin, then go straight to the inline fallback.
- **Any other failure**: retry the dispatch once, then fall inline.

On success, verify the doc rather than trusting the return message:

- Confirm the returned path exists on disk.
- Grep it for the structural anchors `/review-walk` needs: a `## Groups` heading, and at
  least one `### P<X>-<N>:` heading with `**Status:**` on the line below it. If missing,
  treat as a failed dispatch.
- Confirm the frontmatter `target:` matches this run's branch/PR and `date:` matches
  today — this guards against a stale same-path doc from an earlier run.
- Re-read the verified file's `## Summary` section as the source of truth for the
  terminal summary.
- Once the doc passes every check above, delete this run's scratch:
  `rm -rf docs/reviews/.raw/<sanitized-slug>/`. Only after a verified write — never on
  the fallback path, which reads from it. The clean-review case keeps its scratch (there
  is no verified doc to gate on).

### Inline fallback

Read findings from the scratch files at `docs/reviews/.raw/<sanitized-slug>/`, not from
memory. Then locate the synthesizer's rules and template by trying, in order:

1. Read `${CLAUDE_PLUGIN_ROOT}/agents/review/review-synthesizer.md`, if that env var
   resolves to a non-empty path this session.
2. Else `"$(git rev-parse --show-toplevel)"/agents/review/review-synthesizer.md`.
3. If neither Read succeeds, present the raw findings to the user grouped by severity
   rather than exiting with no output.

Follow whichever resolved, and state in the terminal summary that the doc was produced by
fallback, not the synthesizer.

## The review-written stamp

Once the doc has passed every verification check above — the same gate that deleted the
scratch — post a stamp on the issue this review's branch/PR is tied to.

- The **clean-review case posts no stamp**: there is no doc to reference.
- A **fallback-produced doc never passes that gate**, so it posts none either.

Issue-number resolution (including the silent skip when none resolves), posting
mechanics, marker encoding, and failure posture are defined in
[the issue-log spec](../issue-log/SKILL.md). Both reviews emit the **`review-written`**
event; each keeps its own filled template carrying its own `"skill"` value and glyph, per
that spec's writer-fills-its-own-template convention.

The body below the marker heading is the same in both, and nothing else belongs in it:

```markdown
**Doc:** `docs/reviews/<filename>`
**Findings:** <n> P1 / <n> P2 / <n> P3

| Tier | Count | Issue | Category | Effort |
|------|-------|-------|----------|--------|
| P1   | <n>   | **P1-1: <short title>** — <one-line description> | <category> | <effort> |
| P2   | <n>   | **P2-1: <short title>** — <one-line description> | <category> | <effort> |
| P3   | <n>   | _<n> nice-to-haves: <one-line roll-up of themes> (full detail in the review doc)_ | — | — |
```

Compose the body, write it to a temp file with the Write tool, and post:

```bash
gh issue comment <issue> --repo <owner>/<repo> --body-file <temp-file>
```

The table is the same one the completion report builds: every P1 and P2 gets its own row
(copy them from the review doc's Summary), and P3s collapse into one roll-up row.

## The completion report

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
````

Every P1 and P2 gets its own row (copy the rows from the review doc's Summary); P3s are
one roll-up row. Counts appear once per tier.

Review docs are written under `docs/reviews/`, which is gitignored — they are local
working artifacts, not committed repo content. `/review-walk` reads them from the working
tree.

### The review-agents-used section

Each review skill owns this section and lists the agents **it** ran, plus the synthesizer.
It is the one part of the report that differs between the reviews, so neither the roster
nor the shape of its list is defined here.

### The next-steps block

````markdown
### Next Steps

1. **Address P1 findings** — critical; must be fixed before merge.
2. **Sweep the quick wins** — run `/review-sweep docs/reviews/[filename]` to land the quick wins unattended, then `/review-walk` the findings it surfaced.
3. **Walk the review** — run `/review-walk docs/reviews/[filename]` to step through issues group-by-group with implement / defer / skip choices. Status updates land in the review doc, so progress is durable.
4. **Remote-review flow** (this machine is not the one that will land the PR — e.g. a review VM): run `/review-walk` here in this same session, then **`/review-push`** — which commits the applied fixes, pushes them onto the PR branch, and posts a PR comment mapping each finding to its outcome (fixed / deferred / skipped). Nothing needs to leave this machine by hand; the review doc stays local (gitignored) and the PR comment carries its context. On the landing machine, fast-forward the worktree (`git pull --ff-only`) before `/land`.
````

An invoking skill may append its own follow-on offers after this block; it never rewrites
the four items above.

## Important: P1 Findings Block Merge

Any **🔴 P1 (CRITICAL)** findings must be addressed before merging the PR. Present these
prominently and ensure they're resolved before accepting the PR.

## Rules every review inherits

- **Never review with stale code on disk.** The code being analyzed must be the code
  the target names before any review agent is dispatched. How the working tree gets
  that way belongs to the invoking skill.
- **Always pass the protected-artifacts list** in the synthesizer's dispatch, and never
  let a finding against those paths survive into the document.
- **The synthesizer is always-run infrastructure.** Never list it in a review's agent
  roster, and never count it as one of the agents whose findings it synthesizes.
- **Persist raw findings to scratch before dispatching.** The fallback reads from disk,
  not from context — a compaction between dispatch and synthesis must not lose them.
- **Delete scratch only after the document verifies.** Never on the fallback path,
  which reads from it, and never on a clean review, which writes no document.
- **A clean review and a fallback-produced document post no stamp.** The stamp attests
  to a verified document; neither case has one.
- **Never claim a document was written until it verifies.** Confirm it exists, carries
  the structural anchors the walk skills anchor on, and is this run's rather than an
  earlier one's.
- **P1 findings block the merge.** Present them prominently regardless of how the
  review was run.
