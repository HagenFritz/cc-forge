### Related Issue
Extract the issue number from the branch name (the second segment between forward slashes, e.g. `feat/171/some-desc` → `171`). Detect `<owner>/<repo>` from `git remote get-url origin` and cross-reference the issue as: `<owner>/<repo>#<number>`. If the branch uses `no-ref`, write "N/A".

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
