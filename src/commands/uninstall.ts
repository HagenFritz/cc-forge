import { log, outro } from '@clack/prompts'
import { removeSkills, removeAgents } from '../claude.js'

export async function runUninstall(): Promise<void> {
  console.log()

  const removedSkills = removeSkills()
  if (removedSkills.length > 0) {
    log.success(`Removed skills: ${removedSkills.join(', ')}`)
  }

  const removedAgents = removeAgents()
  if (removedAgents.length > 0) {
    log.success(`Removed agent categories: ${removedAgents.join(', ')}`)
  }

  outro('cc-forge uninstalled. Restart Claude Code for changes to take effect.')
}
