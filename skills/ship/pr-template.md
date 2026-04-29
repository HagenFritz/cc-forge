If the branch name contains a numeric issue number (second segment between forward slashes, e.g. `feat/42/some-desc` → `42`), include this line at the very top of the body: `Related to #42`. If the branch uses `no-ref` or the second segment is not a number, omit this line entirely.

### Primary Changes
Bullet list of changes directly related to the branch's purpose. Format:
- <emoji> **<Title>:** <concise summary>

### Related Changes
Bullet list of incidental or supporting changes not directly tied to the branch's purpose. Format:
- <emoji> **<Title>:** <concise summary>

If there are no related changes, omit this section entirely.

---

### Test Plan
- [ ] Bulleted checklist of how to verify the changes

Generated with [Claude Code](https://claude.com/claude-code)
