import { intro, outro, spinner, log, confirm, isCancel } from '@clack/prompts'
import { fileURLToPath } from 'url'
import path from 'path'
import { CAVEMAN_HOOK_FILE, copySkills, copyAgents, copyHooks, hookPath, packageRoot } from '../claude.js'
import { ManifestParseError } from '../manifest.js'
import {
  planAddHookEntry,
  commitAddHookEntry,
  SettingsParseError,
} from '../settings-patcher.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

// One-line description per skill, keyed by skill directory name. Used to render
// the install outro. Missing keys fall back to "(no description)" so adding a
// new skill that lacks an entry here doesn't break the outro.
const SKILL_DESCRIPTIONS: Record<string, string> = {
  brainstorm: 'Explore requirements and approaches',
  plan: 'Create implementation plans',
  work: 'Execute work plans',
  review: 'Multi-agent code review',
  'review-walk': 'Walk through a review doc interactively',
  compound: 'Document learnings',
  ideate: 'Generate improvement ideas',
  'deepen-plan': 'Stress-test plans with targeted research',
  'document-review': 'Review requirement/plan docs',
  deprecate: 'Plan removal of a named concept',
  'test-plan': 'Generate a manual test plan from branch diffs',
  initiative: 'Author and maintain living initiative docs',
  branch: 'Create a branch from an issue number',
  'issue-from-context': 'Create GitHub issues from context',
  'read-issue': 'Fetch and digest a GitHub issue',
  'triage-issue': 'Investigate whether an issue still exists',
  ship: 'Commit, push, and create a PR',
  'commit-all': 'Stage and commit all changes per-file',
  'side-quest': 'Track out-of-scope tasks discovered during execution',
  'stand-up': 'Summarize the past 28h of work',
  caveman: 'Ultra-terse response mode (persists via UserPromptSubmit hook)',
}

interface InstallOptions {
  dryRun?: boolean
  yes?: boolean
}

export async function runInstall(opts: InstallOptions = {}): Promise<void> {
  console.log()
  intro(opts.dryRun ? 'cc-forge — Dry run (no changes will be made)' : 'cc-forge — Development workflows for Claude Code')

  const [major] = process.versions.node.split('.').map(Number)
  if (major < 18) {
    log.error(`Node.js 18+ required. You have ${process.versions.node}`)
    process.exit(1)
  }

  // Skills
  let installedSkills: string[] = []
  const s1 = spinner()
  s1.start(opts.dryRun ? 'Planning skills copy...' : 'Copying skills to ~/.claude/skills/...')
  try {
    if (opts.dryRun) {
      s1.stop(`Would copy skills from ${packageRoot(moduleDir)}/skills/ to ~/.claude/skills/`)
    } else {
      installedSkills = copySkills(packageRoot(moduleDir))
      s1.stop(`Copied ${installedSkills.length} skill(s): ${installedSkills.join(', ')}`)
    }
  } catch (err) {
    s1.stop('Failed to copy skills')
    log.error(String(err))
  }

  // Agents
  let installedAgents: string[] = []
  const s2 = spinner()
  s2.start(opts.dryRun ? 'Planning agents copy...' : 'Copying agents to ~/.claude/agents/...')
  try {
    if (opts.dryRun) {
      s2.stop(`Would copy agents from ${packageRoot(moduleDir)}/agents/ to ~/.claude/agents/`)
    } else {
      installedAgents = copyAgents(packageRoot(moduleDir))
      s2.stop(`Copied agent categories: ${installedAgents.join(', ')}`)
    }
  } catch (err) {
    s2.stop('Failed to copy agents')
    log.error(String(err))
  }

  // Hooks
  let installedHooks: string[] = []
  const s3 = spinner()
  s3.start(opts.dryRun ? 'Planning hooks copy...' : 'Copying hooks to ~/.claude/hooks/...')
  try {
    if (opts.dryRun) {
      s3.stop(`Would copy hook(s) from ${packageRoot(moduleDir)}/hooks/ to ~/.claude/hooks/`)
    } else {
      installedHooks = copyHooks(packageRoot(moduleDir))
      if (installedHooks.length === 0) {
        s3.stop('No hooks to copy')
      } else {
        s3.stop(`Copied hook(s): ${installedHooks.join(', ')}`)
      }
    }
  } catch (err) {
    s3.stop('Failed to copy hooks')
    log.error(String(err))
  }

  // Settings.json patch for caveman hook
  await wireCavemanHook(opts)

  outro(buildOutro({ opts, installedSkills, installedAgents, installedHooks }))
}

interface OutroInput {
  opts: InstallOptions
  installedSkills: string[]
  installedAgents: string[]
  installedHooks: string[]
}

function buildOutro({ opts, installedSkills, installedAgents, installedHooks }: OutroInput): string {
  const header = opts.dryRun
    ? 'cc-forge install --dry-run complete\n(Dry run — no files were created or modified.)\n'
    : 'cc-forge installed!\n'

  const skillsBlock = installedSkills.length === 0
    ? '\nSkills added: (none — install step skipped or failed)'
    : '\nSkills added:\n' +
      installedSkills
        .sort()
        .map(name => `  /${name.padEnd(22)} ${SKILL_DESCRIPTIONS[name] || '(no description)'}`)
        .join('\n')

  const agentsBlock = installedAgents.length === 0
    ? '\n\nAgent categories: (none)'
    : `\n\nAgent categories: ${installedAgents.join(', ')}`

  const hooksBlock = installedHooks.length === 0
    ? ''
    : '\n\nHooks installed:\n' + installedHooks.map(name => `  ${name}  (UserPromptSubmit; off by default)`).join('\n')

  const footer = '\n\nRestart Claude Code for changes to take effect.'

  return header + skillsBlock + agentsBlock + hooksBlock + footer
}

async function wireCavemanHook(opts: InstallOptions): Promise<void> {
  const absHookPath = hookPath(CAVEMAN_HOOK_FILE)
  const cfg = { event: 'UserPromptSubmit', command: absHookPath, timeout: 10 }

  // Step 1: plan (no spinner — pure read of manifest, instantaneous)
  let plan
  try {
    plan = planAddHookEntry(cfg)
  } catch (err) {
    log.error('Failed to plan UserPromptSubmit hook wiring')
    if (err instanceof SettingsParseError || err instanceof ManifestParseError) log.error(err.message)
    else log.error(String(err))
    return
  }

  if (plan.alreadyPresent) {
    log.success('UserPromptSubmit hook already wired (skipped)')
    return
  }

  if (opts.dryRun) {
    log.info(
      `Would add UserPromptSubmit hook to ~/.claude/settings.json:\n` +
        `    matcher: ""\n` +
        `    hooks:[{ type: "command", command: "${absHookPath}", timeout: 10 }]\n` +
        `    manifest entry: kind=settings-hook, event=UserPromptSubmit`,
    )
    return
  }

  // Step 2: confirm (no spinner around interactive prompt)
  if (!opts.yes && process.stdin.isTTY) {
    const proceed = await confirm({
      message:
        'cc-forge will add a UserPromptSubmit hook to ~/.claude/settings.json. This makes /caveman persistence possible. Continue?',
    })
    if (isCancel(proceed) || proceed !== true) {
      log.warn(
        'Skipped settings.json patch. /caveman skill will still work, but persistence requires the hook. Re-run `cc-forge install` to wire it.',
      )
      return
    }
  }

  // Step 3: commit (single spinner for the actual disk write)
  const s = spinner()
  s.start('Wiring UserPromptSubmit hook in settings.json...')
  try {
    const { alreadyPresent, entry } = commitAddHookEntry(cfg)
    s.stop(
      alreadyPresent
        ? `UserPromptSubmit hook already wired (uuid=${entry.uuid.slice(0, 8)}…)`
        : `Wired UserPromptSubmit hook (uuid=${entry.uuid.slice(0, 8)}…)`,
    )
  } catch (err) {
    s.stop('Failed to wire UserPromptSubmit hook')
    if (err instanceof SettingsParseError || err instanceof ManifestParseError) log.error(err.message)
    else log.error(String(err))
  }
}
