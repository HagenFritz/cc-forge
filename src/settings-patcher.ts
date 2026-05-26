import fs from 'fs'
import path from 'path'
import os from 'os'
import * as manifest from './manifest.js'
import { safeAtomicWrite } from './safe-fs.js'

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

export interface HookEntryConfig {
  event: string
  command: string
  timeout?: number
}

interface SettingsHookHandler {
  type: 'command'
  command: string
  timeout?: number
}

interface SettingsHookGroup {
  matcher?: string
  hooks: SettingsHookHandler[]
}

interface SettingsShape {
  hooks?: Record<string, SettingsHookGroup[]>
  [k: string]: unknown
}

export class SettingsParseError extends Error {
  constructor(public readonly underlying: unknown) {
    super(
      `~/.claude/settings.json is not valid JSON. Edit it (remove comments, trailing commas, or BOM) and re-run \`cc-forge install\`. Underlying error: ${String(underlying)}`,
    )
    this.name = 'SettingsParseError'
  }
}

function readSettings(): SettingsShape {
  if (!fs.existsSync(SETTINGS_PATH)) return {}
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8')
  if (raw.trim().length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new SettingsParseError(e)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SettingsParseError(new Error('settings.json must be a JSON object'))
  }
  return parsed as SettingsShape
}

function writeSettingsAtomic(obj: SettingsShape): void {
  // preserveMode: settings.json is the user's file. Don't tighten 0644 to 0600
  // silently if they set it deliberately for another tool to read.
  safeAtomicWrite(SETTINGS_PATH, JSON.stringify(obj, null, 2), { mode: 0o600, preserveMode: true })
}

function resolveCommand(command: string): string {
  if (command.startsWith('~/')) {
    return path.join(os.homedir(), command.slice(2))
  }
  return path.resolve(command)
}

// --- Plan / commit split (for --dry-run) ---------------------------------

export interface AddPlan {
  kind: 'add'
  alreadyPresent: boolean
  event: string
  command: string
  timeout?: number
}

export interface RemovePlan {
  kind: 'remove'
  uuid: string
  event: string
  command: string
}

export function planAddHookEntry(cfg: HookEntryConfig): AddPlan {
  const resolved = resolveCommand(cfg.command)
  const existing = manifest.findEntry(
    e => e.kind === 'settings-hook' && e.event === cfg.event && e.commandPath === resolved,
  )
  return {
    kind: 'add',
    alreadyPresent: existing !== undefined,
    event: cfg.event,
    command: resolved,
    timeout: cfg.timeout,
  }
}

export function commitAddHookEntry(cfg: HookEntryConfig): { alreadyPresent: boolean; entry: manifest.ManifestEntry } {
  const plan = planAddHookEntry(cfg)
  if (plan.alreadyPresent) {
    const existing = manifest.findEntry(
      e => e.kind === 'settings-hook' && e.event === plan.event && e.commandPath === plan.command,
    )
    if (!existing) throw new Error('Internal: alreadyPresent=true but manifest entry missing')
    return { alreadyPresent: true, entry: existing }
  }

  // Snapshot pre-mutation settings so we can roll back if the manifest write
  // fails after the settings.json write succeeds. Without this, settings.json
  // can hold a hook entry the manifest does not own.
  const preMutation = readSettings()
  const settings = JSON.parse(JSON.stringify(preMutation)) as SettingsShape

  settings.hooks = settings.hooks || {}
  const groups = settings.hooks[plan.event] || []
  groups.push({
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: plan.command,
        ...(plan.timeout !== undefined ? { timeout: plan.timeout } : {}),
      },
    ],
  })
  settings.hooks[plan.event] = groups

  writeSettingsAtomic(settings)
  let entry: manifest.ManifestEntry
  try {
    entry = manifest.addEntry({
      kind: 'settings-hook',
      event: plan.event,
      commandPath: plan.command,
    })
  } catch (manifestErr) {
    // Roll back the settings.json write so the two stores stay consistent.
    try {
      writeSettingsAtomic(preMutation)
    } catch (rollbackErr) {
      throw new Error(
        `Manifest write failed AND settings.json rollback failed. settings.json may have an orphan entry. Original: ${String(manifestErr)}. Rollback: ${String(rollbackErr)}`,
      )
    }
    throw manifestErr
  }
  return { alreadyPresent: false, entry }
}

export function planRemoveHookEntry(uuid: string): RemovePlan | null {
  const entry = manifest.findEntry(e => e.uuid === uuid)
  if (!entry || entry.kind !== 'settings-hook') return null
  return {
    kind: 'remove',
    uuid,
    event: entry.event,
    command: entry.commandPath,
  }
}

export function commitRemoveHookEntry(uuid: string): RemovePlan | null {
  const plan = planRemoveHookEntry(uuid)
  if (!plan) return null

  // Snapshot settings.json so we can roll back on manifest failure. Filtering
  // is a no-op when the entry isn't present, which is the legitimate "already
  // cleaned outside cc-forge" case — no extra branch needed.
  const preMutation = readSettings()
  const settings = JSON.parse(JSON.stringify(preMutation)) as SettingsShape
  const groups = settings.hooks?.[plan.event] || []
  const filtered = groups
    .map(g => ({
      ...g,
      hooks: (g.hooks || []).filter(h => h.command !== plan.command),
    }))
    .filter(g => g.hooks.length > 0)

  if (settings.hooks) {
    if (filtered.length === 0) {
      delete settings.hooks[plan.event]
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks
    } else {
      settings.hooks[plan.event] = filtered
    }
  }
  writeSettingsAtomic(settings)

  try {
    manifest.removeEntry(uuid)
  } catch (manifestErr) {
    try {
      writeSettingsAtomic(preMutation)
    } catch (rollbackErr) {
      throw new Error(
        `Manifest update failed AND settings.json rollback failed. Original: ${String(manifestErr)}. Rollback: ${String(rollbackErr)}`,
      )
    }
    throw manifestErr
  }
  return plan
}

// --- Read helpers for doctor ---------------------------------------------

export function isWiredForEntry(entry: manifest.ManifestEntry): boolean {
  if (!fs.existsSync(SETTINGS_PATH)) return false
  try {
    const settings = readSettings()
    const groups = settings.hooks?.[entry.event] || []
    return groups.some(g => g.hooks?.some(h => h.command === entry.commandPath))
  } catch {
    return false
  }
}
