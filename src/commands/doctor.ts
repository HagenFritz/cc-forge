import { intro, log, outro } from '@clack/prompts'
import fs from 'fs'
import path from 'path'
import os from 'os'

export async function runDoctor(): Promise<void> {
  console.log()
  intro('cc-forge doctor')

  const home = os.homedir()
  const checks = [
    { name: 'Skills (plan)', path: path.join(home, '.claude', 'skills', 'plan', 'SKILL.md') },
    { name: 'Skills (review)', path: path.join(home, '.claude', 'skills', 'review', 'SKILL.md') },
    { name: 'Agents (research)', path: path.join(home, '.claude', 'agents', 'research') },
    { name: 'Agents (review)', path: path.join(home, '.claude', 'agents', 'review') },
    { name: 'Agents (workflow)', path: path.join(home, '.claude', 'agents', 'workflow') },
  ]

  let allGood = true
  for (const check of checks) {
    if (fs.existsSync(check.path)) {
      log.success(`${check.name}: OK`)
    } else {
      log.warn(`${check.name}: not found`)
      allGood = false
    }
  }

  // Future: check gh CLI, toggl-cc, etc.

  outro(allGood ? 'Everything looks good!' : 'Some checks failed. Run `npx cc-forge install` to fix.')
}
