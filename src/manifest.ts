import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { safeAtomicWrite } from './safe-fs.js'

const MANIFEST_PATH = path.join(os.homedir(), '.claude', '.cc-forge-manifest.json')
const MANIFEST_VERSION = 1

export interface ManifestEntry {
  uuid: string
  kind: 'settings-hook'
  event: string
  commandPath: string
  createdAt: string
}

interface Manifest {
  version: number
  entries: ManifestEntry[]
}

export class ManifestParseError extends Error {
  constructor(public readonly underlying: unknown) {
    super(
      `~/.claude/.cc-forge-manifest.json is not valid JSON. cc-forge uses this file to track what it owns in settings.json — losing it means losing your uninstall handle. Inspect the file; if you can't recover it and don't have cc-forge entries to preserve, remove it and re-run \`cc-forge install\`. Underlying: ${String(underlying)}`,
    )
    this.name = 'ManifestParseError'
  }
}

function readManifestRaw(): Manifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { version: MANIFEST_VERSION, entries: [] }
  }
  let raw: string
  try {
    raw = fs.readFileSync(MANIFEST_PATH, 'utf8')
  } catch (e) {
    throw new ManifestParseError(e)
  }
  if (raw.trim().length === 0) {
    return { version: MANIFEST_VERSION, entries: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new ManifestParseError(e)
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as { entries?: unknown }).entries)
  ) {
    throw new ManifestParseError(new Error('manifest must be a JSON object with an `entries` array'))
  }
  const obj = parsed as { version?: number; entries: ManifestEntry[] }
  return { version: obj.version || MANIFEST_VERSION, entries: obj.entries }
}

// Best-effort variant for callers that should never throw on a corrupt manifest
// (e.g., the doctor command, which wants to *report* the corruption itself).
function readManifestSafe(): Manifest | { error: ManifestParseError } {
  try {
    return readManifestRaw()
  } catch (e) {
    if (e instanceof ManifestParseError) return { error: e }
    return { error: new ManifestParseError(e) }
  }
}

function writeManifestAtomic(m: Manifest): void {
  safeAtomicWrite(MANIFEST_PATH, JSON.stringify(m, null, 2), { mode: 0o600 })
}

// Throws ManifestParseError on corruption — call sites that need to act on the
// manifest (install/uninstall) propagate; the doctor command uses
// `readManifestForReport` instead.
export function entries(): ManifestEntry[] {
  return [...readManifestRaw().entries]
}

export function findEntry(predicate: (e: ManifestEntry) => boolean): ManifestEntry | undefined {
  return readManifestRaw().entries.find(predicate)
}

export function readManifestForReport(): Manifest | { error: ManifestParseError } {
  return readManifestSafe()
}

export function addEntry(partial: Omit<ManifestEntry, 'uuid' | 'createdAt'>): ManifestEntry {
  const m = readManifestRaw()
  const entry: ManifestEntry = {
    ...partial,
    uuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  m.entries.push(entry)
  writeManifestAtomic(m)
  return entry
}

export function removeEntry(uuid: string): boolean {
  const m = readManifestRaw()
  const before = m.entries.length
  m.entries = m.entries.filter(e => e.uuid !== uuid)
  if (m.entries.length === before) return false
  writeManifestAtomic(m)
  return true
}

export function deleteManifest(): void {
  try { fs.unlinkSync(MANIFEST_PATH) } catch (e) { /* silent */ }
}

export function manifestExists(): boolean {
  return fs.existsSync(MANIFEST_PATH)
}
