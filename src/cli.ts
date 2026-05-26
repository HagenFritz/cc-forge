#!/usr/bin/env node
export {}

const args = process.argv.slice(2)
const command = args[0]
const hasDryRun = args.includes('--dry-run')
const hasYes = args.includes('--yes') || args.includes('-y')
const hasJson = args.includes('--json')

switch (command) {
  case 'install': {
    const { runInstall } = await import('./commands/install.js')
    await runInstall({ dryRun: hasDryRun, yes: hasYes })
    break
  }
  case 'uninstall': {
    const { runUninstall } = await import('./commands/uninstall.js')
    await runUninstall({ dryRun: hasDryRun })
    break
  }
  case 'doctor': {
    const { runDoctor } = await import('./commands/doctor.js')
    await runDoctor({ json: hasJson })
    break
  }
  default: {
    console.log(`cc-forge — Development workflows for Claude Code

Usage:
  npx cc-forge install [--dry-run] [--yes]   Install skills, agents, and hooks
  npx cc-forge uninstall [--dry-run]         Remove cc-forge files and settings entries
  npx cc-forge doctor [--json]               Check installation health (non-zero exit on failure)

Flags:
  --dry-run        Print planned changes and exit without writing
  --yes, -y        (install only) Skip the first-time confirm; wire hook automatically
  --json           (doctor only) Emit a structured JSON report instead of human output
`)
    process.exit(command ? 1 : 0)
  }
}
