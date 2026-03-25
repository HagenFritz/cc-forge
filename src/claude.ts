import fs from 'fs'
import path from 'path'
import os from 'os'

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents')

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function copySkills(packageRoot: string): string[] {
  const skillsSource = path.join(packageRoot, 'skills')
  if (!fs.existsSync(skillsSource)) {
    throw new Error(`Skills directory not found at ${skillsSource}`)
  }

  const copied: string[] = []
  for (const name of fs.readdirSync(skillsSource)) {
    const src = path.join(skillsSource, name)
    if (!fs.statSync(src).isDirectory()) continue
    copyDirRecursive(src, path.join(SKILLS_DIR, name))
    copied.push(name)
  }
  return copied
}

export function copyAgents(packageRoot: string): string[] {
  const agentsSource = path.join(packageRoot, 'agents')
  if (!fs.existsSync(agentsSource)) {
    throw new Error(`Agents directory not found at ${agentsSource}`)
  }

  const copied: string[] = []
  for (const category of fs.readdirSync(agentsSource)) {
    const src = path.join(agentsSource, category)
    if (!fs.statSync(src).isDirectory()) continue
    copyDirRecursive(src, path.join(AGENTS_DIR, category))
    copied.push(category)
  }
  return copied
}

export function removeSkills(): string[] {
  const skillNames = [
    'brainstorm', 'compound', 'deepen-plan', 'document-review',
    'frontend-design', 'git-worktree', 'ideate', 'plan', 'review', 'work',
  ]
  const removed: string[] = []
  for (const name of skillNames) {
    const dir = path.join(SKILLS_DIR, name)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true })
      removed.push(name)
    }
  }
  return removed
}

export function removeAgents(): string[] {
  const agentCategories = ['research', 'review', 'workflow']
  const removed: string[] = []
  for (const cat of agentCategories) {
    const dir = path.join(AGENTS_DIR, cat)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true })
      removed.push(cat)
    }
  }
  return removed
}
