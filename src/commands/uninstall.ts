import { log, outro } from '@clack/prompts'
import { fileURLToPath } from 'url'
import path from 'path'
import { removeSkills, removeAgents } from '../claude.js'

function packageRoot(): string {
  const distDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(distDir, '..')
}

export async function runUninstall(): Promise<void> {
  console.log()

  const removedSkills = removeSkills(packageRoot())
  if (removedSkills.length > 0) {
    log.success(`Removed skills: ${removedSkills.join(', ')}`)
  }

  const removedAgents = removeAgents()
  if (removedAgents.length > 0) {
    log.success(`Removed agent categories: ${removedAgents.join(', ')}`)
  }

  outro('cc-forge uninstalled. Restart Claude Code for changes to take effect.')
}
