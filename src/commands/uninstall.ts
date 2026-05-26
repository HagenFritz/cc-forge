import { intro, log, outro, spinner } from '@clack/prompts'
import { fileURLToPath } from 'url'
import path from 'path'
import {
  removeSkills,
  removeAgents,
  removeHooks,
  packageRoot,
} from '../claude.js'
import { deleteFlagFile } from '../caveman.js'
import * as manifest from '../manifest.js'
import { ManifestParseError } from '../manifest.js'
import {
  commitRemoveHookEntry,
  planRemoveHookEntry,
  SettingsParseError,
} from '../settings-patcher.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

interface UninstallOptions {
  dryRun?: boolean
}

export async function runUninstall(opts: UninstallOptions = {}): Promise<void> {
  console.log()
  intro(opts.dryRun ? 'cc-forge uninstall — Dry run (no changes will be made)' : 'cc-forge uninstall')

  // Track whether every settings.json cleanup succeeded; if any failed, we
  // preserve the manifest so a re-run can finish the job.
  let settingsCleanupComplete = true

  // Read manifest safely — corruption shouldn't crash uninstall before we get
  // a chance to clean up filesystem-only state.
  const manifestRead = manifest.readManifestForReport()
  if ('error' in manifestRead) {
    log.warn(`Manifest is corrupted; skipping settings.json cleanup. ${manifestRead.error.message}`)
    settingsCleanupComplete = false
  } else if (manifestRead.entries.length === 0) {
    log.info('No manifest entries to remove from settings.json')
  } else {
    for (const entry of manifestRead.entries) {
      const s = spinner()
      s.start(
        opts.dryRun
          ? `Planning removal of ${entry.kind} entry (${entry.event}, uuid=${entry.uuid.slice(0, 8)}…)...`
          : `Removing ${entry.kind} entry (${entry.event}, uuid=${entry.uuid.slice(0, 8)}…)...`,
      )

      if (opts.dryRun) {
        try {
          const plan = planRemoveHookEntry(entry.uuid)
          if (!plan) {
            s.stop(`Manifest entry not found (already cleaned?)`)
          } else {
            s.stop(
              `Would remove from ~/.claude/settings.json:\n` +
                `    event: ${plan.event}\n` +
                `    command: ${plan.command}`,
            )
          }
        } catch (err) {
          s.stop(`Failed to plan removal of ${entry.event} entry`)
          if (err instanceof SettingsParseError) log.error(err.message)
          else log.error(String(err))
          settingsCleanupComplete = false
        }
        continue
      }

      try {
        const result = commitRemoveHookEntry(entry.uuid)
        if (!result) {
          s.stop('Manifest entry not found')
        } else {
          s.stop(`Removed ${result.event} entry`)
        }
      } catch (err) {
        s.stop(`Failed to remove ${entry.event} entry`)
        if (err instanceof SettingsParseError || err instanceof ManifestParseError) {
          log.error(err.message)
        } else {
          log.error(String(err))
        }
        settingsCleanupComplete = false
      }
    }
  }

  // Filesystem cleanup — runs even if settings.json cleanup failed, because
  // these files are cc-forge-owned and re-installable.
  if (opts.dryRun) {
    log.info(`Would remove cc-forge-owned files from ~/.claude/skills/, ~/.claude/agents/, ~/.claude/hooks/`)
    log.info(`Would delete ~/.claude/.caveman-active if present`)
    if (settingsCleanupComplete) {
      log.info(`Would delete ~/.claude/.cc-forge-manifest.json`)
    } else {
      log.warn(`Would PRESERVE ~/.claude/.cc-forge-manifest.json (settings.json cleanup did not complete)`)
    }
  } else {
    const removedSkills = removeSkills(packageRoot(moduleDir))
    if (removedSkills.length > 0) {
      log.success(`Removed skills: ${removedSkills.join(', ')}`)
    }

    const removedAgents = removeAgents()
    if (removedAgents.length > 0) {
      log.success(`Removed agent categories: ${removedAgents.join(', ')}`)
    }

    const removedHooks = removeHooks()
    if (removedHooks.length > 0) {
      log.success(`Removed hooks: ${removedHooks.join(', ')}`)
    }

    if (deleteFlagFile()) {
      log.success('Deleted ~/.claude/.caveman-active')
    }

    if (settingsCleanupComplete) {
      if (manifest.manifestExists()) {
        manifest.deleteManifest()
        log.success('Deleted ~/.claude/.cc-forge-manifest.json')
      }
    } else if (manifest.manifestExists()) {
      log.warn(
        'Preserved ~/.claude/.cc-forge-manifest.json because settings.json cleanup did not complete. Fix the parse error in settings.json, then re-run `cc-forge uninstall`.',
      )
    }
  }

  const outroMessage = settingsCleanupComplete
    ? opts.dryRun
      ? 'cc-forge uninstall --dry-run complete. (No changes made.)'
      : 'cc-forge uninstalled. Restart Claude Code for changes to take effect.'
    : 'cc-forge uninstall partial. Some settings.json entries could not be cleaned; manifest preserved for retry.'

  outro(outroMessage)

  if (!settingsCleanupComplete) process.exit(1)
}
