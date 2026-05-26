import fs from 'fs'
import path from 'path'
import os from 'os'

// Caveman runtime state — not the bundled hook script. The hook lives in
// hooks/ and is owned by the generic claude.ts hook copier. The flag file is
// the mode-state counterpart that the hook reads/writes at runtime.

export const FLAG_FILE = path.join(os.homedir(), '.claude', '.caveman-active')

export function deleteFlagFile(): boolean {
  if (fs.existsSync(FLAG_FILE)) {
    try { fs.unlinkSync(FLAG_FILE); return true } catch { return false }
  }
  return false
}
