#!/usr/bin/env node
export {}

const command = process.argv[2]

switch (command) {
  case 'install': {
    const { runInstall } = await import('./commands/install.js')
    await runInstall()
    break
  }
  case 'uninstall': {
    const { runUninstall } = await import('./commands/uninstall.js')
    await runUninstall()
    break
  }
  case 'doctor': {
    const { runDoctor } = await import('./commands/doctor.js')
    await runDoctor()
    break
  }
  default: {
    console.log(`cc-forge — Development workflows for Claude Code

Usage:
  npx cc-forge install          Install skills and agents
  npx cc-forge uninstall        Remove skills and agents
  npx cc-forge doctor           Check installation health
`)
    process.exit(command ? 1 : 0)
  }
}
