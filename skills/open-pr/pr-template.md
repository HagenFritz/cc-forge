# PR Template

Fill the fenced skeleton below and use it as the PR body. Replace every `<...>` placeholder and remove the fence itself.

- **`Related to #<n>`:** the first line when the caller has an issue number; omit it otherwise. Never a closing keyword.
- **`### Why`:** one or two sentences on the problem this PR solves, not what it changes.
- **`### Primary Changes`:** one bullet per change directly tied to the branch's purpose, as `- <emoji> **<Title>:** <concise summary>`.
- **`### Related Changes`:** incidental or supporting changes, in the same bullet format. Omit the heading and its bullets entirely when there are none.
- **`**Pre-merge Tests**`:** only checks CI cannot run; backtick-prefixed items are run by `/land`.
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
