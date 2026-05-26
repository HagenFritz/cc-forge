import fs from 'fs'
import path from 'path'

// Atomic write with symlink-safe temp path, fsync before rename, and optional
// mode preservation. Mirrors the discipline used by the caveman hook's
// safeWriteFlag: an attacker who can pre-create the (predictable) temp path as
// a symlink should not be able to redirect our write.
//
// preserveMode: if the target file already exists, copy its mode to the new
// file instead of using `mode`. Used for settings.json so a user who set 0644
// deliberately keeps that.

export function safeAtomicWrite(
  targetPath: string,
  content: string,
  options: { mode: number; preserveMode?: boolean } = { mode: 0o600 },
): void {
  const dir = path.dirname(targetPath)
  fs.mkdirSync(dir, { recursive: true })

  // Use a per-invocation tmp name so the path isn't a fixed attacker target.
  const tmp = path.join(dir, `.${path.basename(targetPath)}.cc-forge-tmp.${process.pid}.${Date.now()}`)

  // Decide effective mode: caller default, or preserve existing target mode.
  let mode = options.mode
  if (options.preserveMode) {
    try {
      const st = fs.statSync(targetPath)
      // mask to permission bits
      mode = st.mode & 0o777
    } catch {
      // target doesn't exist — fall through to default mode
    }
  }

  // Best-effort: remove any leftover tmp at this exact path before open.
  // O_EXCL means open will fail if it exists, which is what we want, but a
  // stale tmp from a crashed prior run would block legitimate writes — so
  // clean it up first if it exists and is a regular file we own.
  try {
    const st = fs.lstatSync(tmp)
    if (st.isFile()) fs.unlinkSync(tmp)
  } catch {
    // ENOENT is fine
  }

  const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW
  let fd: number | undefined
  try {
    fd = fs.openSync(tmp, flags, mode)
    fs.writeSync(fd, content)
    try { fs.fsyncSync(fd) } catch { /* best-effort durability */ }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  fs.renameSync(tmp, targetPath)
}
