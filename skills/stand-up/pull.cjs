#!/usr/bin/env node
// cc-forge /stand-up data pull. Read-only: the one ref update is
// `git fetch origin main prod`, which moves remote-tracking refs only.

'use strict'

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const USAGE = 'usage: pull.cjs [--since <YYYY-MM-DD | YYYY-MM-DDTHH:MM>] [--out <path>]'
const MAX_BUFFER = 256 * 1024 * 1024
const PR_LIMIT = '1000'
const PROD_PR_LIMIT = '300'
const GRAPHQL_BATCH = 100
const STATUS_RANK = { open: 0, 'main only': 1, 'in prod': 2 }
const BODY_REF = /\b(?:related to|close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i
const MARKER = /^<!-- cc-forge-log v(\d+): (\{.*\}) -->$/
const DOC_DIRS = { work: 'work', plans: 'plan', reviews: 'review', brainstorms: 'brainstorm', tests: 'test' }
const RETIRED_GRIND_EVENTS = new Set(['tests-run', 'pr-reviewed', 'pr-merged'])
const PLANNING_EVENTS = new Set([
  'requirements-written', 'brainstorm-walk-complete', 'plan-written', 'plan-deepened', 'blueprint-walk-complete', 'side-quest-filed',
])

const warnings = []
const notRead = []

function usageError(msg) {
  process.stderr.write(`stand-up: ${msg}; ${USAGE}\n`)
  process.exit(2)
}

function die(msg) {
  process.stderr.write(`stand-up: ${msg}\n`)
  process.exit(1)
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] })
}

function errText(err) {
  return String(err.stderr || err.message).trim().split('\n')[0]
}

function tryRun(what, cmd, args, cwd) {
  try {
    return run(cmd, args, cwd)
  } catch (err) {
    warnings.push(`${what}: ${errText(err)}`)
    return null
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function localIso(d) {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function weekday(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long' })
}

function parseSince(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value)
  if (!m) usageError(`--since must be a date or a local datetime, got "${value}"`)
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1).map((v) => (v === undefined ? undefined : Number(v)))
  const date = new Date(y, mo - 1, d, h, mi, s)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h || date.getMinutes() !== mi) {
    usageError(`--since is not a real local date or time: "${value}"`)
  }
  return date
}

function defaultStart(now) {
  const back = { 0: 2, 1: 3, 6: 1 }[now.getDay()] ?? 1
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 10, 0, 0)
}

function parseArgs(argv) {
  let since = null
  let out = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--since') {
      if (i + 1 >= argv.length) usageError('--since needs a value')
      since = argv[++i]
    } else if (arg.startsWith('--since=')) {
      since = arg.slice('--since='.length)
    } else if (arg === '--out') {
      if (i + 1 >= argv.length) usageError('--out needs a value')
      out = argv[++i]
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length)
    } else {
      usageError(`unknown argument "${arg}"`)
    }
  }
  return { since, out }
}

function resolveWindow(since) {
  const now = new Date()
  const start = since ? parseSince(since) : defaultStart(now)
  if (start >= now) usageError('--since must be in the past')
  return {
    start: localIso(start),
    end: localIso(now),
    startWeekday: weekday(start),
    endWeekday: weekday(now),
    source: since ? 'since' : 'default',
    startMs: start.getTime(),
  }
}

function resolveRepo() {
  try {
    run('git', ['rev-parse', '--git-common-dir'], process.cwd())
  } catch {
    die('not inside a git repository; run /stand-up from the repo or one of its worktrees')
  }
  const worktrees = parseWorktrees(run('git', ['worktree', 'list', '--porcelain'], process.cwd()))
  const main = worktrees[0].path
  try {
    run('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/prod'], main)
  } catch {
    die('this repo has no origin/prod; /stand-up needs a repo whose origin has a prod branch')
  }
  const url = run('git', ['remote', 'get-url', 'origin'], main).trim()
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url)
  if (!m) die(`origin is not a GitHub remote: ${url}`)
  return { main, worktrees, owner: m[1], name: m[2], slug: `${m[1]}/${m[2]}` }
}

function ghLogin() {
  try {
    return run('gh', ['api', 'user', '--jq', '.login']).trim()
  } catch {
    die('gh is not authenticated; run `gh auth login`, then retry')
  }
}

function fetchRefs(main) {
  try {
    run('git', ['fetch', '--quiet', 'origin', 'main', 'prod'], main)
  } catch (err) {
    die(`git fetch origin main prod failed (${errText(err)}); deploy status would be stale, so the run stops — retry`)
  }
}

function parseWorktrees(porcelain) {
  const out = []
  for (const block of porcelain.split(/\n\n+/)) {
    const wt = { path: null, head: null, branch: null, detached: false, prunable: false, bare: false }
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9)
      else if (line.startsWith('HEAD ')) wt.head = line.slice(5)
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace(/^refs\/heads\//, '')
      else if (line === 'detached') wt.detached = true
      else if (line.startsWith('prunable')) wt.prunable = true
      else if (line === 'bare') wt.bare = true
    }
    if (wt.path) out.push(wt)
  }
  return out
}

function branchIssue(branch) {
  const seg = (branch || '').split('/')[1]
  return seg && /^\d+$/.test(seg) ? Number(seg) : null
}

function pathIssue(path) {
  const m = /\/(\d+)\/[^/]+\/?$/.exec(path)
  return m ? Number(m[1]) : null
}

function bodyIssue(body) {
  const m = BODY_REF.exec(body || '')
  return m ? Number(m[1]) : null
}

function inWindow(iso, win) {
  return iso != null && Date.parse(iso) >= win.startMs
}

function listOwnPrs(slug) {
  const out = run('gh', [
    'pr', 'list', '--repo', slug, '--author', '@me', '--state', 'all', '--limit', PR_LIMIT,
    '--json', 'number,title,url,state,baseRefName,headRefName,mergedAt,closedAt,mergeCommit',
  ])
  const prs = JSON.parse(out)
  if (prs.length === Number(PR_LIMIT)) warnings.push(`gh pr list hit its ${PR_LIMIT}-PR limit; older PRs merged in the window could be missed`)
  return prs
}

function listProdMerges(slug) {
  const out = tryRun('merged prod PRs', 'gh', [
    'pr', 'list', '--repo', slug, '--base', 'prod', '--state', 'merged', '--limit', PROD_PR_LIMIT,
    '--json', 'number,title,mergeCommit',
  ])
  const byOid = new Map()
  for (const pr of out ? JSON.parse(out) : []) {
    if (pr.mergeCommit) byOid.set(pr.mergeCommit.oid, { number: pr.number, title: pr.title })
  }
  return byOid
}

// gh exits non-zero when any alias fails to resolve; the partial data is still on stdout.
function graphql(repo, fields) {
  const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields}}}`
  let out
  try {
    out = run('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${repo.owner}`, '-F', `name=${repo.name}`])
  } catch (err) {
    out = err.stdout
    if (!out) {
      warnings.push(`GitHub GraphQL read failed: ${errText(err)}`)
      return {}
    }
  }
  try {
    return JSON.parse(out).data?.repository ?? {}
  } catch {
    warnings.push('GitHub GraphQL returned unreadable output')
    return {}
  }
}

function batched(numbers, fieldFor) {
  const result = {}
  for (let i = 0; i < numbers.length; i += GRAPHQL_BATCH) {
    Object.assign(result, fieldFor(numbers.slice(i, i + GRAPHQL_BATCH)))
  }
  return result
}

function fetchPrBodies(repo, numbers) {
  const bodies = new Map()
  const data = batched(numbers, (chunk) =>
    graphql(repo, chunk.map((n) => `p${n}:pullRequest(number:${n}){body}`).join(' ')))
  for (const n of numbers) {
    if (data[`p${n}`]) bodies.set(n, data[`p${n}`].body)
    else warnings.push(`PR #${n}: body not read`)
  }
  return bodies
}

function fetchIssues(repo, numbers) {
  const issues = new Map()
  const data = batched(numbers, (chunk) =>
    graphql(repo, chunk.map((n) => `i${n}:issueOrPullRequest(number:${n}){__typename ... on Issue{number title parent{number title}}}`).join(' ')))
  for (const n of numbers) {
    const node = data[`i${n}`]
    if (node?.__typename === 'Issue') issues.set(n, { number: n, title: node.title, parent: node.parent ?? null })
  }
  return issues
}

function prodHistory(main, win) {
  const fp = tryRun('prod first-parent history', 'git', ['rev-list', '--first-parent', `--since=${win.start}`, 'origin/prod'], main)
  const range = tryRun('origin/main..origin/prod subjects', 'git', ['log', '--format=%H%x00%s', 'origin/main..origin/prod'], main)
  const bySubjectPr = new Map()
  for (const line of (range || '').split('\n').filter(Boolean)) {
    const [sha, subject] = line.split('\0')
    for (const m of subject.matchAll(/\(#(\d+)\)/g)) {
      const n = Number(m[1])
      if (!bySubjectPr.has(n)) bySubjectPr.set(n, [])
      bySubjectPr.get(n).push(sha)
    }
  }
  return { firstParent: (fp || '').split('\n').filter(Boolean), bySubjectPr }
}

function isAncestor(main, a, b) {
  try {
    run('git', ['merge-base', '--is-ancestor', a, b], main)
    return true
  } catch (err) {
    if (err.status !== 1) warnings.push(`ancestry check ${a.slice(0, 9)}: ${errText(err)}`)
    return false
  }
}

// Containment is monotone along prod's first-parent chain (newest first), so binary-search the oldest container.
function earliestCarrier(main, firstParent, sha) {
  let lo = 0
  let hi = firstParent.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (isAncestor(main, sha, firstParent[mid])) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found === -1 ? null : firstParent[found]
}

function deploy(main, pr, prod, carriers) {
  if (pr.state === 'OPEN') return { deployStatus: 'open', carriedBy: null }
  if (pr.state !== 'MERGED') return { deployStatus: null, carriedBy: null }
  const candidates = [...(prod.bySubjectPr.get(pr.number) || [])]
  const oid = pr.mergeCommit?.oid
  if (oid && isAncestor(main, oid, 'origin/prod')) candidates.push(oid)
  if (candidates.length === 0) return { deployStatus: 'main only', carriedBy: null }
  let carrier = null
  let carrierIdx = -1
  for (const sha of candidates) {
    const c = earliestCarrier(main, prod.firstParent, sha)
    const idx = c ? prod.firstParent.indexOf(c) : -1
    if (idx > carrierIdx) {
      carrier = c
      carrierIdx = idx
    }
  }
  const carriedBy = carrier ? carriers.get(carrier) ?? null : null
  if (carrier && !carriedBy) warnings.push(`PR #${pr.number}: prod merge ${carrier.slice(0, 9)} matches no merged prod PR`)
  return { deployStatus: 'in prod', carriedBy }
}

function prState(pr) {
  return { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' }[pr.state]
}

function shapePr(pr, body, status, keyedBy) {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    body,
    state: prState(pr),
    base: pr.baseRefName,
    branch: pr.headRefName,
    mergedAt: pr.mergedAt || null,
    closedAt: pr.closedAt || null,
    deployStatus: status.deployStatus,
    carriedBy: status.carriedBy,
    keyedBy,
  }
}

function parseCommits(out) {
  return (out || '').split('\n').filter(Boolean).map((line) => {
    const [sha, subject, authorDate, email] = line.split('\0')
    return { sha, subject, authorDate, email }
  })
}

function readWorktree(wt, email, win, mergedPrByBranch) {
  const where = wt.path
  const last = parseCommits(tryRun(`${where}: last commit`, 'git', ['log', '-1', '--format=%H%x00%s%x00%aI%x00%ae'], where))[0]
  const status = tryRun(`${where}: status`, 'git', ['--no-optional-locks', 'status', '--porcelain'], where)
  const dirty = (status || '').split('\n').filter(Boolean).map((l) => l.slice(3))
  const merged = wt.branch ? mergedPrByBranch.get(wt.branch) : null
  const own = parseCommits(tryRun(`${where}: branch commits`, 'git', ['log', '--format=%H%x00%s%x00%aI%x00%ae', 'origin/main..HEAD'], where))
    .filter((c) => c.email.toLowerCase() === email)
    .filter((c) => inWindow(c.authorDate, win))
    .filter((c) => !merged || Date.parse(c.authorDate) > Date.parse(merged.mergedAt))
    .map(({ sha, subject, authorDate }) => ({ sha, subject, authorDate }))
  let aheadBehind = null
  let unpushed = null
  if (!merged) {
    const counts = tryRun(`${where}: ahead/behind`, 'git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], where)
    if (counts) {
      const [behind, ahead] = counts.trim().split(/\s+/).map(Number)
      aheadBehind = { ahead, behind }
    }
    const up = tryRun(`${where}: unpushed`, 'git', ['log', '--format=%H%x00%s%x00%aI%x00%ae', 'HEAD', '--not', '--remotes=origin'], where)
    if (up !== null) unpushed = parseCommits(up).map(({ sha, subject }) => ({ sha, subject }))
  }
  return {
    worktree: {
      path: wt.path,
      branch: wt.branch,
      detached: wt.detached,
      mainCheckout: wt.mainCheckout,
      lastCommit: last ? { sha: last.sha, subject: last.subject, authorDate: last.authorDate } : null,
      mergedPr: merged ? { number: merged.number, mergedAt: merged.mergedAt } : null,
      aheadBehind,
      dirty,
      unpushed,
    },
    commits: own,
  }
}

function frontmatter(text) {
  const fm = {}
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return fm
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*?)\s*$/.exec(line)
    if (kv) fm[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return fm
}

function readInitiatives(main, slug) {
  const dir = path.join(main, 'docs', 'initiatives')
  const byParent = new Map()
  let names
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    if (err.code !== 'ENOENT') warnings.push(`${dir}: ${err.message}`)
    return byParent
  }
  const local = (n) => (n.endsWith('.local.md') ? 1 : 0)
  for (const name of names.filter((n) => n.endsWith('.md')).sort((a, b) => local(a) - local(b) || a.localeCompare(b))) {
    const file = path.join(dir, name)
    let fm
    try {
      fm = frontmatter(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      notRead.push({ kind: 'skipped-doc', ref: file, reason: err.message })
      continue
    }
    const m = /^(.+)#(\d+)$/.exec(fm.parent_issue || '')
    if (!m || m[1].toLowerCase() !== slug.toLowerCase()) continue
    const n = Number(m[2])
    if (!byParent.has(n)) byParent.set(n, { doc: file, title: fm.title || null })
  }
  return byParent
}

function initiativeFor(info, initiatives) {
  if (!info.parent) return null
  const doc = initiatives.get(info.parent.number)
  return { key: info.parent.number, title: doc?.title || info.parent.title, doc: doc?.doc ?? null }
}

const docScans = new Map()

function scanDocs(root) {
  if (docScans.has(root)) return docScans.get(root)
  const docs = []
  for (const [dir, kind] of Object.entries(DOC_DIRS)) {
    const abs = path.join(root, 'docs', dir)
    let names
    try {
      names = fs.readdirSync(abs)
    } catch (err) {
      if (err.code !== 'ENOENT') warnings.push(`${abs}: ${err.message}`)
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.md') || name.startsWith('.')) continue
      const file = path.join(abs, name)
      try {
        const text = fs.readFileSync(file, 'utf8')
        docs.push({ path: file, rel: `docs/${dir}/${name}`, name, kind, mtimeMs: fs.statSync(file).mtimeMs, fm: frontmatter(text), text: kind === 'plan' ? text : null })
      } catch (err) {
        notRead.push({ kind: 'skipped-doc', ref: file, reason: err.message })
      }
    }
  }
  docScans.set(root, docs)
  return docs
}

function nameHasIssue(name, n) {
  const stem = name.replace(/^\d{4}-\d{2}-\d{2}-(?:\d{3}-)?/, '')
  return new RegExp(`(?:^|\\D)${n}(?:\\D|$)`).test(stem)
}

// Plan text (#N) runs before origin: so a fresh worktree's plan, linked only by its text, still pulls in its brainstorm.
function linkDocs(docs, number, branches, allowText) {
  const linked = new Map()
  const add = (d, by) => linked.has(d.path) || linked.set(d.path, { doc: d, linkedBy: by })
  for (const d of docs) {
    if (d.fm.target && branches.has(d.fm.target)) add(d, 'target')
    else if (number && nameHasIssue(d.name, number)) add(d, 'filename')
  }
  const named = (kind, key) => new Set([...linked.values()].filter((l) => l.doc.kind === kind && l.doc.fm[key]).map((l) => path.basename(l.doc.fm[key])))
  const workPlans = named('work', 'plan')
  for (const d of docs) if (d.kind === 'plan' && workPlans.has(d.name)) add(d, 'work-plan')
  if (allowText && number) {
    const ref = new RegExp(`#${number}(?!\\d)`)
    for (const d of docs) if (d.kind === 'plan' && ref.test(d.text)) add(d, 'plan-text')
  }
  const origins = named('plan', 'origin')
  for (const d of docs) if (origins.has(d.name)) add(d, 'plan-origin')
  return [...linked.values()]
}

function groupDocs(group, roots, number, allowText) {
  const branches = new Set([
    ...group.worktrees.map((w) => w.branch),
    ...group.prs.map((p) => p.branch),
    ...(group.stamps || []).map((s) => s.fields.branch),
  ].filter(Boolean))
  const byRel = new Map()
  for (const root of roots) {
    for (const { doc, linkedBy } of linkDocs(scanDocs(root), number, branches, allowText)) {
      const prev = byRel.get(doc.rel)
      if (!prev || doc.mtimeMs > prev.doc.mtimeMs) byRel.set(doc.rel, { doc, linkedBy })
    }
  }
  return [...byRel.values()]
    .sort((a, b) => b.doc.mtimeMs - a.doc.mtimeMs)
    .map(({ doc, linkedBy }) => ({ path: doc.path, kind: doc.kind, mtime: localIso(new Date(doc.mtimeMs)), linkedBy }))
}

// `since` filters on updated_at, so created_at is re-checked per comment.
function fetchStamps(repo, login, win) {
  const since = new Date(win.startMs).toISOString()
  const out = tryRun('issue-log stamps', 'gh', [
    'api', '--paginate', `repos/${repo.slug}/issues/comments?since=${since}&per_page=100`,
    '--jq', '.[] | {issue_url, html_url, created_at, user: {login: .user.login}, body}',
  ])
  const latest = new Map()
  for (const line of (out || '').split('\n').filter(Boolean)) {
    const c = JSON.parse(line)
    if (c.user.login !== login || Date.parse(c.created_at) < win.startMs) continue
    const m = MARKER.exec((c.body || '').split('\n')[0].replace(/\r$/, ''))
    if (!m) continue
    if (m[1] !== '1') {
      warnings.push(`stamp ${c.html_url}: unknown marker version v${m[1]}, skipped`)
      continue
    }
    let marker
    try {
      marker = JSON.parse(m[2])
    } catch {
      warnings.push(`stamp ${c.html_url}: marker JSON does not parse, skipped`)
      continue
    }
    const { skill, event: rawEvent, ...fields } = marker
    const event = skill === 'review-walk' && rawEvent === 'walk-complete' ? 'review-walk-complete' : rawEvent
    if (skill === 'grind' && RETIRED_GRIND_EVENTS.has(event)) continue
    const issue = Number(/\/issues\/(\d+)$/.exec(c.issue_url)?.[1])
    const plan = fields.unit ? (fields.paths || []).find((p) => p.includes('docs/plans/')) || '' : ''
    const key = [issue, skill, event, fields.unit ?? '', plan].join('\0')
    const ms = Date.parse(c.created_at)
    if (!latest.has(key) || ms >= latest.get(key).ms) {
      latest.set(key, { issue, ms, stamp: { skill, event, createdAt: localIso(new Date(ms)), url: c.html_url, fields } })
    }
  }
  const byIssue = new Map()
  for (const { issue, stamp } of [...latest.values()].sort((a, b) => a.ms - b.ms)) {
    if (!byIssue.has(issue)) byIssue.set(issue, [])
    byIssue.get(issue).push(stamp)
  }
  return byIssue
}

// A dirty file only counts as activity when it was touched in the window; a deleted one has no mtime and counts.
function dirtyInWindow(wt, win) {
  return wt.dirty.some((f) => {
    try {
      return fs.statSync(path.join(wt.path, f.split(' -> ').pop().replace(/^"|"$/g, ''))).mtimeMs >= win.startMs
    } catch {
      return true
    }
  })
}

function markActivity(group, win) {
  const times = [
    ...group.commits.map((c) => c.authorDate),
    ...group.prs.map((p) => p.mergedAt || p.closedAt),
    ...group.docs.map((d) => d.mtime).filter((t) => inWindow(t, win)),
    ...(group.stamps || []).map((s) => s.createdAt),
  ].filter(Boolean).map(Date.parse)
  group.active = times.length > 0 || group.prs.length > 0 || group.worktrees.some((w) => dirtyInWindow(w, win))
  group.lastActivity = times.length ? localIso(new Date(Math.max(...times))) : null
  return group
}

function emptyGroup(extra) {
  return { ...extra, active: false, lastActivity: null, deployStatus: null, prs: [], worktrees: [], commits: [], docs: [] }
}

function rollUp(group) {
  const ranks = group.prs.map((p) => p.deployStatus).filter((s) => s != null).map((s) => STATUS_RANK[s])
  const min = ranks.length ? Math.min(...ranks) : null
  group.deployStatus = min == null ? null : Object.keys(STATUS_RANK).find((k) => STATUS_RANK[k] === min)
  const seen = new Set()
  group.commits = group.commits
    .filter((c) => !seen.has(c.sha) && seen.add(c.sha))
    .sort((a, b) => Date.parse(b.authorDate) - Date.parse(a.authorDate))
  return group
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const win = resolveWindow(args.since)
  const repo = resolveRepo()
  const login = ghLogin()
  fetchRefs(repo.main)
  const fetchedAt = localIso(new Date())
  const email = (tryRun('git user.email', 'git', ['config', 'user.email'], repo.main) || '').trim().toLowerCase()
  if (!email) warnings.push('git user.email is unset; no local commits are counted')

  let allPrs
  try {
    allPrs = listOwnPrs(repo.slug)
  } catch (err) {
    die(`gh pr list failed (${errText(err)}); retry`)
  }

  const mergedPrByBranch = new Map()
  for (const pr of allPrs) {
    if (pr.state !== 'MERGED' || pr.baseRefName === 'prod') continue
    const prev = mergedPrByBranch.get(pr.headRefName)
    if (!prev || Date.parse(pr.mergedAt) > Date.parse(prev.mergedAt)) mergedPrByBranch.set(pr.headRefName, pr)
  }

  const scoped = allPrs.filter((pr) =>
    pr.state === 'OPEN' || (pr.state === 'MERGED' && inWindow(pr.mergedAt, win)) || (pr.state === 'CLOSED' && inWindow(pr.closedAt, win)))
  const bodies = fetchPrBodies(repo, scoped.map((pr) => pr.number))
  const prod = prodHistory(repo.main, win)
  const carriers = listProdMerges(repo.slug)

  const worktrees = repo.worktrees.map((wt, i) => ({ ...wt, mainCheckout: i === 0 })).filter((wt) => {
    if (wt.bare) return false
    if (wt.prunable) warnings.push(`${wt.path}: registered worktree is missing on disk (prunable)`)
    return !wt.prunable
  })

  const candidates = new Set()
  for (const pr of scoped) {
    for (const n of [branchIssue(pr.headRefName), bodyIssue(bodies.get(pr.number))]) if (n) candidates.add(n)
  }
  for (const wt of worktrees) {
    const n = wt.detached ? pathIssue(wt.path) : branchIssue(wt.branch)
    if (n) candidates.add(n)
  }
  const stamps = fetchStamps(repo, login, win)
  for (const n of stamps.keys()) if (n) candidates.add(n)
  const issueInfo = fetchIssues(repo, [...candidates])
  const initiatives = readInitiatives(repo.main, repo.slug)

  const issues = new Map()
  const unkeyed = new Map()
  const issueGroup = (n) => {
    if (!issues.has(n)) {
      const info = issueInfo.get(n)
      issues.set(n, emptyGroup({ number: n, title: info.title, initiative: initiativeFor(info, initiatives), stamps: [] }))
    }
    return issues.get(n)
  }
  const unkeyedGroup = (key) => unkeyed.get(key) || unkeyed.set(key, emptyGroup({ key })).get(key)
  const prodPrs = []

  for (const pr of scoped) {
    const body = bodies.get(pr.number) ?? null
    if (pr.baseRefName === 'prod') {
      if (pr.state !== 'CLOSED') prodPrs.push({ number: pr.number, title: pr.title, url: pr.url, state: prState(pr), branch: pr.headRefName, mergedAt: pr.mergedAt || null })
      continue
    }
    const status = deploy(repo.main, pr, prod, carriers)
    const fromBranch = branchIssue(pr.headRefName)
    const fromBody = bodyIssue(body)
    if (fromBranch && issueInfo.has(fromBranch)) issueGroup(fromBranch).prs.push(shapePr(pr, body, status, 'branch'))
    else if (fromBody && issueInfo.has(fromBody)) issueGroup(fromBody).prs.push(shapePr(pr, body, status, 'body'))
    else unkeyedGroup(pr.headRefName).prs.push(shapePr(pr, body, status, null))
  }

  for (const wt of worktrees) {
    const { worktree, commits } = readWorktree(wt, email, win, mergedPrByBranch)
    const n = wt.detached ? pathIssue(wt.path) : branchIssue(wt.branch)
    const group = n && issueInfo.has(n) ? issueGroup(n) : unkeyedGroup(wt.branch || wt.path)
    group.worktrees.push(worktree)
    group.commits.push(...commits)
  }

  for (const [n, list] of stamps) if (issueInfo.has(n)) issueGroup(n).stamps = list

  for (const group of issues.values()) {
    const roots = group.worktrees.map((w) => w.path)
    group.docs = roots.length ? groupDocs(group, roots, group.number, true) : groupDocs(group, [repo.main], group.number, false)
  }
  for (const group of unkeyed.values()) {
    const roots = group.worktrees.length ? group.worktrees.filter((w) => !w.mainCheckout).map((w) => w.path) : [repo.main]
    group.docs = groupDocs(group, roots, null, false)
  }

  const activeIssues = []
  const idle = []
  for (const group of [...issues.values()].map(rollUp).map((g) => markActivity(g, win)).sort((a, b) => b.number - a.number)) {
    if (group.active) activeIssues.push(group)
    else if (group.worktrees.length) {
      idle.push({ number: group.number, title: group.title, initiative: group.initiative, worktrees: group.worktrees.map((w) => w.path), docs: group.docs })
    }
    const work = group.stamps.filter((s) => !PLANNING_EVENTS.has(s.event))
    if (work.length && !group.worktrees.length && !group.prs.length) {
      notRead.push({
        kind: 'other-machine',
        ref: group.number,
        reason: `stamps show ${[...new Set(work.map((s) => s.event))].join(', ')} but no local worktree or PR; worktree on another machine or removed`,
      })
    }
  }

  const out = {
    window: { start: win.start, end: win.end, startWeekday: win.startWeekday, endWeekday: win.endWeekday, source: win.source },
    login,
    repo: repo.slug,
    mainCheckout: repo.main,
    fetchedAt,
    issues: activeIssues,
    prodPrs: prodPrs.sort((a, b) => a.number - b.number),
    unkeyed: [...unkeyed.values()].map(rollUp).map((g) => markActivity(g, win)).filter((g) => g.active),
    idle,
    notRead,
    warnings,
  }
  const json = `${JSON.stringify(out, null, 2)}\n`
  if (!args.out) {
    process.stdout.write(json)
    return
  }
  try {
    fs.writeFileSync(args.out, json)
  } catch (err) {
    die(`cannot write ${args.out} (${errText(err)})`)
  }
  process.stdout.write(`stand-up: ${out.issues.length} issues, ${out.unkeyed.length} unkeyed, ${out.idle.length} idle, ${out.prodPrs.length} prod PRs, ${notRead.length} not read, ${warnings.length} warnings -> ${args.out}\n`)
}

main()
