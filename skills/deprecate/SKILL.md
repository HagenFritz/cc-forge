---
name: deprecate
description: >
  Safely remove or retire a named concept (component, function, class, route, DB column,
  event name, config key, etc.) from a codebase. Triggers on phrases like "deprecate X",
  "remove X", "rip out X", "retire X", "sunset X", "clean up X", "get rid of X", or
  "cut X out". Spawns parallel research agents to find every reference and produces a
  dated, leaves-first deprecation plan with backward-compat risk flags. Plan-only —
  hand the resulting file to /work to execute.
user-invocable: true
argument-hint: "<symbol-or-concept>"
allowed-tools: Bash, Agent, Read, Write
---

# Deprecate

Produce a safe, reviewable plan for removing a named concept from the codebase. This skill
**plans only** — it never deletes code. Hand the plan to `/work` to execute.

## Step 1: Parse and Validate

- The argument is the symbol or concept to deprecate (e.g., `LegacyAuthMiddleware`,
  `/api/v1/users`, `user_legacy_id`, `BillingEventV1`).
- If no argument is provided, STOP and ask the user what to deprecate.
- If the argument is a generic English word that will match thousands of unrelated lines
  (e.g., `user`, `data`, `handler`, `config`), STOP and ask the user to disambiguate
  (full path, fully-qualified name, or an exact symbol).

Detect the repo root:

```bash
git rev-parse --show-toplevel
```

## Step 2: Build Name Variants

Generate variants to scan for:

- The argument as-given
- PascalCase (e.g., `LegacyAuthMiddleware`)
- snake_case (e.g., `legacy_auth_middleware`)
- camelCase (e.g., `legacyAuthMiddleware`)
- SCREAMING_SNAKE (e.g., `LEGACY_AUTH_MIDDLEWARE`)
- kebab-case for routes/config (e.g., `legacy-auth-middleware`)

Pass the full variant list to both agents below.

## Step 3: Run Parallel Investigation Agents

Spawn two agents in parallel using the Agent tool. Do NOT wait for one before launching the other.

### Agent 1: Codebase Smell Scan

```
subagent_type: cc-forge:research:repo-research-analyst

Prompt:
You are scoping the deprecation of `<TARGET>` from this repository.

Name variants to scan: <list all variants from Step 2>

Find every reference to this concept. Cover ALL of the following categories:

1. **Direct code references**
   - Python: `import`, `from ... import`, calls, type annotations, base classes
   - TypeScript/JS: `import` statements, JSX (`<X`), prop usage, hook calls, type references
   - Re-exports in `__init__.py`, `index.ts`, package `exports` fields

2. **String references**
   - Route strings (FastAPI `@router.get("/x")`, Express paths, Next.js routes)
   - Event names (`emit("x")`, `on("x")`, pub/sub topics)
   - Config keys, environment variable names, feature-flag strings
   - Celery / queue task names, LangGraph node/edge names

3. **DB schema references**
   - SQLAlchemy / Prisma / Drizzle / TypeORM model fields and table names
   - Raw SQL strings (both snake_case and camelCase variants)
   - Alembic / migration files — flag these but DO NOT recommend deletion; a new drop
     migration is the correct path

4. **Docs, comments, and metadata**
   - Docstrings, inline `# ...` / `// ...` comments
   - TODO/FIXME/HACK comments mentioning the target
   - Markdown docs, README, CHANGELOG
   - `package.json` scripts, `.env.example`, IaC/config files

Suggested search commands:

```bash
rg -n "<variant>" --type py --type ts --type tsx --type js -g "!node_modules" -g "!.git"
rg -in "<variant>" -g "!node_modules" -g "!.git"
rg -n "<variant>" migrations/ alembic/ db/ schema/ 2>/dev/null
rg -n "<variant>" --type json --type md
```

Report (use file:line for every hit):
- **Source definition** — where the concept is defined (file:line). If multiple, list all.
- **Importers / direct usages** — files that import or call it (file:line each)
- **String references** — routes, events, config keys (file:line each)
- **DB references** — model fields, migrations, raw SQL (file:line each)
- **Docs & comments** — docstrings, READMEs, TODOs (file:line each)
- **Tests** — test files referencing it (file:line each)
- **Generated files** — anything that looks auto-generated (`*.pb.py`, `*.gen.ts`)
- **Cross-package references** — if monorepo, which packages reference it

For each reference, note if it appears to be a public/exported boundary
(`__init__.py`, `index.ts`, package `exports`, API route handlers).
```

### Agent 2: Git History & Compat Context

```
subagent_type: cc-forge:research:git-history-analyzer

Prompt:
You are scoping the deprecation of `<TARGET>` from this repository.

Investigate the git history to inform backward-compatibility risk:

1. When and where was this concept introduced?
   git log --all --diff-filter=A -- '*<filename>*' 2>/dev/null
   git log -S"<TARGET>" --all --oneline | tail -20

2. Has any prior deprecation, rename, or partial removal already happened?
   git log --all --oneline --grep="<TARGET>" --grep="deprecate" --grep="remove"

3. Is the symbol part of a published / external surface?
   - Search for it in CHANGELOG entries, release notes, README, package.json, pyproject.toml
   - Check if it appears in a `__all__` list, `index.ts` re-export, or package `exports`

4. Is there in-flight queue or migration risk?
   - Search migrations directory for the target — is there an applied migration that added it?
   - Search for Celery task name strings or queue message types matching the target

Report:
- **Introduction commit** (hash, date, brief summary)
- **Prior deprecation activity** — any commits or PRs that already touched this concept
- **External surface evidence** — appearances in CHANGELOG, README, public exports, .env.example
- **Migration / queue risk** — applied DB migrations, in-flight queue task names
- **Compat verdict** — `low`, `medium`, or `high` risk, with one-sentence reasoning
```

## Step 4: Synthesize and Assess Compat Risk

After both agents return, combine findings. Flag each reference with
`⚠️ COMPAT RISK: <reason>` when ANY of the following apply:

- Exported at a package boundary (`__init__.py`, `index.ts`, `exports` field)
- Public API route (could be called by external clients or another service)
- Appears in a published SDK or package surface
- Referenced by an applied DB migration (queue a drop migration; don't delete)
- Celery / queue task name or event string (in-flight messages may still reference it)
- Appears in `.env.example`, CHANGELOG, README, or external docs
- Crosses a monorepo package boundary

## Step 5: Write the Deprecation Plan

Ensure `docs/deprecations/` exists. On first run, append `docs/deprecations/` to
`.gitignore` (creating the file if missing) — deprecation plans are local working
artifacts.

Determine the filename:
- Find today's existing files to pick the next 3-digit sequence number (starting at 001)
- Format: `docs/deprecations/YYYY-MM-DD-NNN-<slug>.md`
- Slug is a kebab-case version of the target (2–5 words)

Write the plan with this structure:

```markdown
---
target: <exact symbol or concept>
date: YYYY-MM-DD
status: PENDING REVIEW
compat_risk: low | medium | high
---

# Deprecation Plan: <Target>

## Summary

<2–3 sentence description of what is being removed and why it likely exists. Pull from
the git history agent's findings.>

## Scope

- **References found:** <N> across <M> files
- **Source definition:** `path/to/file.ext:LL`
- **Public surface:** <yes/no — explain>
- **Test coverage:** <files that test this concept>

## Risk Summary

<Bullet list of every compat risk found. If none, state "No backward-compat risks
identified — appears internal-only.">

- ⚠️ <risk 1 with file:line and one-sentence reason>
- ⚠️ <risk 2 ...>

## Execution Order

Tasks are grouped **leaves first**: dependents are removed before the source definition.
Each task is a hard cut (delete) unless otherwise noted.

### Group 1 — Tests

> Removed first since they depend on the source but nothing depends on them.

- [ ] `path/to/test_x.py:LL` — remove `test_<name>` (lines LL–LL)
- [ ] `path/to/X.test.tsx` — delete file entirely

### Group 2 — String references (routes, events, config)

- [ ] `src/api/routes.py:LL` — remove route `/api/v1/x` and handler
  - ⚠️ COMPAT RISK: external clients may call this endpoint directly

### Group 3 — DB references

- [ ] `db/models/user.py:LL` — drop column `user_legacy_id` from model
- [ ] `migrations/` — create NEW drop migration (do not delete prior migrations):

  ```bash
  alembic revision --autogenerate -m "drop_user_legacy_id"
  ```

### Group 4 — Docs, comments, metadata

- [ ] `README.md:LL` — remove section referencing target
- [ ] `.env.example:LL` — remove env var entry
- [ ] `CHANGELOG.md` — add entry noting removal

### Group 5 — Importers and direct usages

- [ ] `src/services/foo.py:LL` — remove call to `X.method()` and unused import
- [ ] `src/components/Bar.tsx:LL` — remove `<X />` and clean up imports

### Group 6 — Source definition (LAST)

- [ ] `src/legacy/x.py` — delete file entirely
  - ⚠️ COMPAT RISK: re-exported from `src/__init__.py`; remove that export in the same commit

## Edge Cases

<Only include subsections that apply.>

### Generated files
- `<file>` is auto-generated — regenerate after upstream removal, do not hand-edit.

### Circular references
- <If A ↔ B, note here and ask user how to break the cycle before /work executes.>

### Cross-package refs (monorepo)
- Package `<name>` imports the target. Removal must land atomically across both packages.

## Skipped / Out of Scope

<Anything found but intentionally excluded, with reason.>

## Suggested Follow-up

Run `/work docs/deprecations/YYYY-MM-DD-NNN-<slug>.md` to execute this plan.
```

## Step 6: Present Summary

After writing the file, present a concise terminal summary:

```
## Deprecation Plan Ready

**Target:** <target>
**References:** <N> across <M> files
**Compat risk:** <low | medium | high>
**Risks flagged:** <count>

**Plan:** docs/deprecations/YYYY-MM-DD-NNN-<slug>.md

Next: review the plan, then run `/work docs/deprecations/...` to execute.
```

## Rules

- **Plan-only.** Never delete code or run destructive commands. Hand off to `/work`.
- Always detect the repo from the current working directory.
- Never delete migration files — always queue a new drop migration instead.
- Every task in the plan must include `file:line` so `/work` can act precisely.
- If the two agents disagree on whether something is a public surface, treat it as
  COMPAT RISK and let the user decide.
- Acknowledge uncertainty: static analysis can miss dynamic references (string-based
  lookups, reflection). Call this out in the plan's Risk Summary when relevant.
