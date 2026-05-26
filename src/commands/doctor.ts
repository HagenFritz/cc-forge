import { intro, log, outro } from '@clack/prompts'
import fs from 'fs'
import path from 'path'
import { CAVEMAN_HOOK_FILE, CLAUDE_DIR, hookPath } from '../claude.js'
import { FLAG_FILE } from '../caveman.js'
import * as manifest from '../manifest.js'
import { isWiredForEntry } from '../settings-patcher.js'

const CAVEMAN_LEVELS = ['lite', 'full', 'ultra']

type CheckStatus = 'ok' | 'warn' | 'info'

interface CheckResult {
  name: string
  status: CheckStatus
  detail: string
}

interface CavemanReport {
  hookFile: { path: string; present: boolean }
  manifest: { present: boolean; entryUuid: string | null; orphan: boolean; corrupted: boolean; corruptionDetail: string | null }
  settingsWired: boolean
  mode: 'inactive' | 'invalid' | 'active'
  level: string | null
}

interface DoctorReport {
  ok: boolean
  checks: CheckResult[]
  caveman: CavemanReport
}

interface DoctorOptions {
  json?: boolean
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<void> {
  const report = collectReport()

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exit(report.ok ? 0 : 1)
  }

  renderHuman(report)
  process.exit(report.ok ? 0 : 1)
}

function collectReport(): DoctorReport {
  const checks: CheckResult[] = []

  const coreChecks = [
    { name: 'Skills (plan)', path: path.join(CLAUDE_DIR, 'skills', 'plan', 'SKILL.md') },
    { name: 'Skills (review)', path: path.join(CLAUDE_DIR, 'skills', 'review', 'SKILL.md') },
    { name: 'Skills (caveman)', path: path.join(CLAUDE_DIR, 'skills', 'caveman', 'SKILL.md') },
    { name: 'Agents (research)', path: path.join(CLAUDE_DIR, 'agents', 'research') },
    { name: 'Agents (review)', path: path.join(CLAUDE_DIR, 'agents', 'review') },
    { name: 'Agents (workflow)', path: path.join(CLAUDE_DIR, 'agents', 'workflow') },
  ]
  for (const c of coreChecks) {
    checks.push({
      name: c.name,
      status: fs.existsSync(c.path) ? 'ok' : 'warn',
      detail: fs.existsSync(c.path) ? 'OK' : 'not found',
    })
  }

  const caveman = collectCavemanReport()
  for (const c of cavemanReportToChecks(caveman)) checks.push(c)

  const ok = checks.every(c => c.status !== 'warn')
  return { ok, checks, caveman }
}

function collectCavemanReport(): CavemanReport {
  const absHookPath = hookPath(CAVEMAN_HOOK_FILE)
  const hookFilePresent = fs.existsSync(absHookPath)

  const manifestPresent = manifest.manifestExists()
  const manifestReadResult = manifest.readManifestForReport()
  const corrupted = 'error' in manifestReadResult
  const corruptionDetail = corrupted ? manifestReadResult.error.message : null

  const manifestEntry = corrupted
    ? undefined
    : manifestReadResult.entries.find(
        e => e.kind === 'settings-hook' && e.event === 'UserPromptSubmit' && e.commandPath === absHookPath,
      )
  const manifestOrphan = manifestPresent && !corrupted && !manifestEntry

  const settingsWired = manifestEntry ? isWiredForEntry(manifestEntry) : false

  // Flag-file: the hook enforces symlink/size/whitelist on write. Trust that
  // and read simply — if a manual writer broke any of those invariants the
  // hook would have ignored the file too.
  let mode: CavemanReport['mode'] = 'inactive'
  let level: string | null = null
  if (fs.existsSync(FLAG_FILE)) {
    try {
      const content = fs.readFileSync(FLAG_FILE, 'utf8').trim().toLowerCase()
      if (CAVEMAN_LEVELS.includes(content)) { mode = 'active'; level = content }
      else mode = 'invalid'
    } catch {
      mode = 'invalid'
    }
  }

  return {
    hookFile: { path: absHookPath, present: hookFilePresent },
    manifest: {
      present: manifestPresent,
      entryUuid: manifestEntry?.uuid || null,
      orphan: manifestOrphan,
      corrupted,
      corruptionDetail,
    },
    settingsWired,
    mode,
    level,
  }
}

function cavemanReportToChecks(c: CavemanReport): CheckResult[] {
  // Hierarchical: stop at the first root failure.
  if (!c.hookFile.present) {
    return [
      {
        name: 'Caveman hook',
        status: 'warn',
        detail: `hook file not found at ${c.hookFile.path}. Run \`cc-forge install\` to wire.`,
      },
    ]
  }

  if (!c.manifest.present) {
    return [
      { name: 'Caveman hook file', status: 'ok', detail: c.hookFile.path },
      {
        name: 'Caveman manifest',
        status: 'warn',
        detail: 'not found at ~/.claude/.cc-forge-manifest.json. Run `cc-forge install` to wire.',
      },
    ]
  }

  if (c.manifest.corrupted) {
    return [
      { name: 'Caveman hook file', status: 'ok', detail: c.hookFile.path },
      {
        name: 'Caveman manifest',
        status: 'warn',
        detail: `corrupted: ${c.manifest.corruptionDetail}`,
      },
    ]
  }

  if (c.manifest.orphan) {
    return [
      { name: 'Caveman hook file', status: 'ok', detail: c.hookFile.path },
      { name: 'Caveman manifest', status: 'warn', detail: 'present but contains no entry for caveman hook' },
    ]
  }

  const out: CheckResult[] = [
    { name: 'Caveman hook file', status: 'ok', detail: c.hookFile.path },
    { name: 'Caveman manifest', status: 'ok', detail: `present (uuid=${c.manifest.entryUuid?.slice(0, 8)}…)` },
    {
      name: 'Caveman settings.json',
      status: c.settingsWired ? 'ok' : 'warn',
      detail: c.settingsWired
        ? 'wired'
        : 'not wired (manifest references entry but settings.json does not contain it)',
    },
  ]

  if (c.mode === 'invalid') {
    out.push({ name: 'Caveman mode', status: 'warn', detail: 'flag file is symlinked, oversized, or unrecognized — delete manually' })
  } else if (c.mode === 'inactive') {
    out.push({ name: 'Caveman mode', status: 'ok', detail: 'inactive' })
  } else if (c.mode === 'active') {
    if (!c.settingsWired) {
      out.push({
        name: 'Caveman mode',
        status: 'warn',
        detail: `active (${c.level}) BUT hook not wired — mode will not take effect. Run \`cc-forge install\` to fix.`,
      })
    } else {
      out.push({ name: 'Caveman mode', status: 'ok', detail: `active (${c.level})` })
    }
  }

  return out
}

function renderHuman(report: DoctorReport): void {
  console.log()
  intro('cc-forge doctor')
  for (const c of report.checks) {
    if (c.status === 'ok') log.success(`${c.name}: ${c.detail}`)
    else if (c.status === 'warn') log.warn(`${c.name}: ${c.detail}`)
    else log.info(`${c.name}: ${c.detail}`)
  }
  outro(report.ok ? 'Everything looks good!' : 'Some checks failed. Run `npx cc-forge install` to fix.')
}
