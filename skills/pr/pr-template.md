# PR Template

Fill the fenced skeleton below and use it as the PR body. Only the skeleton is copied; nothing in this instructions section ever reaches a PR body. Replace every `<...>` placeholder and remove the fence itself.

- **`Related to #<n>`:** the very first line, only when the branch name carries a numeric issue number (second `/`-delimited segment, e.g. `feat/42/some-desc` → `Related to #42`). With no issue number, omit the line. Never write a closing keyword such as `Closes #N`.
- **`### Why`:** one or two sentences on the problem this PR solves, not what it changes. Take it from the source the calling skill names.
- **`### Primary Changes`:** one bullet per change directly tied to the branch's purpose, as `- <emoji> **<Title>:** <concise summary>`.
- **`### Related Changes`:** incidental or supporting changes, in the same bullet format. Omit the heading and its bullets entirely when there are none.
- **`**Pre-merge Tests**`:** only checks CI cannot run, such as suites gated on a local database. An item whose text begins with a backtick-delimited command is runnable by `/land`; anything else is listed for a human.
- **`**Post-merge Tests**`:** manual verifications or checks that need the merged state, such as a production deployment check.
- **Empty checklist:** when either checklist has no items, write the single line `- None` in place of its placeholder.

```markdown
Related to #<n>

### Why
<one or two sentences>

### Primary Changes
- <emoji> **<Title>:** <concise summary>

### Related Changes
- <emoji> **<Title>:** <concise summary>

---

### Test Plan

**Pre-merge Tests**
- [ ] <check>

**Post-merge Tests**
- [ ] <check>
```
