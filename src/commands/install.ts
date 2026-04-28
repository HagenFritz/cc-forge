import { intro, outro, spinner, log } from '@clack/prompts'
import { fileURLToPath } from 'url'
import path from 'path'
import { copySkills, copyAgents } from '../claude.js'

function packageRoot(): string {
  const distDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(distDir, '..')
}

export async function runInstall(): Promise<void> {
  console.log()
  intro('cc-forge — Development workflows for Claude Code')

  const [major] = process.versions.node.split('.').map(Number)
  if (major < 18) {
    log.error(`Node.js 18+ required. You have ${process.versions.node}`)
    process.exit(1)
  }

  // Copy skills
  const s1 = spinner()
  s1.start('Copying skills to ~/.claude/skills/...')
  try {
    const copied = copySkills(packageRoot())
    s1.stop(`Copied ${copied.length} skill(s): ${copied.join(', ')}`)
  } catch (err) {
    s1.stop('Failed to copy skills')
    log.error(String(err))
  }

  // Copy agents
  const s2 = spinner()
  s2.start('Copying agents to ~/.claude/agents/...')
  try {
    const copied = copyAgents(packageRoot())
    s2.stop(`Copied agent categories: ${copied.join(', ')}`)
  } catch (err) {
    s2.stop('Failed to copy agents')
    log.error(String(err))
  }

  outro(`cc-forge installed!

Skills added:
  /brainstorm                Explore requirements and approaches
  /plan                      Create implementation plans
  /work                      Execute work plans
  /review                    Multi-agent code review
  /compound                  Document learnings
  /ideate                    Generate improvement ideas
  /deepen-plan               Enhance plans with research
  /document-review           Review requirement/plan docs
  /git-worktree              Manage git worktrees
  /frontend-design           Design-quality frontend code
  /initiative                Author and maintain living initiative docs
  /branch                    Create a branch from an issue number
  /create-issue-from-context Create GitHub issues from context
  /create-initiative         Publish an initiative to GitHub issues
  /ship                      Commit, push, and create a PR

Agent categories: research, review, workflow

Restart Claude Code for changes to take effect.`)
}
