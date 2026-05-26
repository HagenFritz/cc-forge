import fs from 'fs'
import path from 'path'
import os from 'os'

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents')
const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks')

const HOOK_PREFIX = 'cc-forge-'

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

  const sourceSkills = new Set(
    fs.readdirSync(skillsSource).filter(name =>
      fs.statSync(path.join(skillsSource, name)).isDirectory()
    )
  )

  // Prune installed skills that no longer exist in source
  if (fs.existsSync(SKILLS_DIR)) {
    for (const name of fs.readdirSync(SKILLS_DIR)) {
      const installed = path.join(SKILLS_DIR, name)
      if (!fs.statSync(installed).isDirectory()) continue
      const marker = path.join(installed, '.cc-forge')
      if (fs.existsSync(marker) && !sourceSkills.has(name)) {
        fs.rmSync(installed, { recursive: true })
      }
    }
  }

  const copied: string[] = []
  for (const name of sourceSkills) {
    const src = path.join(skillsSource, name)
    const dest = path.join(SKILLS_DIR, name)
    copyDirRecursive(src, dest)
    fs.writeFileSync(path.join(dest, '.cc-forge'), '')
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

export function removeSkills(packageRoot?: string): string[] {
  const removed: string[] = []
  if (!fs.existsSync(SKILLS_DIR)) return removed

  for (const name of fs.readdirSync(SKILLS_DIR)) {
    const dir = path.join(SKILLS_DIR, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const marker = path.join(dir, '.cc-forge')
    // Remove if marker present, or if name matches source skills (legacy installs)
    const inSource = packageRoot
      ? fs.existsSync(path.join(packageRoot, 'skills', name))
      : false
    if (fs.existsSync(marker) || inSource) {
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

export function copyHooks(packageRoot: string): string[] {
  const hooksSource = path.join(packageRoot, 'hooks')
  if (!fs.existsSync(hooksSource)) return []

  fs.mkdirSync(HOOKS_DIR, { recursive: true })
  const copied: string[] = []
  for (const name of fs.readdirSync(hooksSource)) {
    if (!name.startsWith(HOOK_PREFIX)) continue
    const src = path.join(hooksSource, name)
    if (!fs.statSync(src).isFile()) continue
    const dest = path.join(HOOKS_DIR, name)
    fs.copyFileSync(src, dest)
    fs.chmodSync(dest, 0o755)
    copied.push(name)
  }
  return copied
}

export function removeHooks(): string[] {
  if (!fs.existsSync(HOOKS_DIR)) return []
  const removed: string[] = []
  for (const name of fs.readdirSync(HOOKS_DIR)) {
    if (!name.startsWith(HOOK_PREFIX)) continue
    const file = path.join(HOOKS_DIR, name)
    if (!fs.statSync(file).isFile()) continue
    fs.unlinkSync(file)
    removed.push(name)
  }
  return removed
}

export function hookPath(name: string): string {
  return path.join(HOOKS_DIR, name)
}

export const CLAUDE_DIR = path.join(os.homedir(), '.claude')

export const CAVEMAN_HOOK_FILE = 'cc-forge-caveman-mode-tracker.cjs'

export function packageRoot(distDirOfThisModule: string): string {
  return path.resolve(distDirOfThisModule, '..')
}
