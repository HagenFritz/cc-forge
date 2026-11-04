#!/usr/bin/env bash
#
# stack — a configured app's per-worktree local stack (web, LangGraph backend, Postgres).
set -euo pipefail

REGISTRY="$HOME/.local/state/cc-forge-stack"
SLOTS="1 2 3 4 5 6 7 8 9"
WEB_PORT_BASE=3000
BACKEND_PORT_BASE=2024
DB_PORT_BASE=5435
LABEL_PREFIX="local.cc-forge-stack"
GUI_DOMAIN="gui/$(id -u)"
LOG_LINES=50
LOCK_WAIT=60
DB_WAIT=90
DOCKER_WAIT=120
SERVICE_WAIT=180
STOP_WAIT=30
FAIL_LINES=20
STACK_TTL=43200
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
OVERRIDE="$SCRIPT_DIR/compose.override.yml"
CONFIG="$SCRIPT_DIR/stack.local.conf"
DUMP_TRAILER="PostgreSQL database cluster dump complete"

usage() {
  cat <<'EOF'
usage: stack.sh <command>
  up                       start this worktree's stack on its slot (claims one if needed)
  restart                  reinstall, re-migrate, and restart on the same slot, keeping data
  down [slot]              remove this worktree's stack, or the given slot's (1-9)
  down --worktree <path>   remove that worktree's stack; silent when it has none
  status                   every stack: slot, state, time left, ports, branch, worktree (default)
  logs                     tail of this worktree's service logs
  url                      this worktree's web URL when its stack is running
  check                    exit 0 only inside a configured app's worktree (not the main checkout)
EOF
}

die() {
  echo "stack: $*" >&2
  exit 1
}

# Without a config, /land's teardown call and other skills' check call stay silent no-ops.
if [ ! -f "$CONFIG" ]; then
  case "${1:-}" in
    check) exit 1 ;;
    down) if [ "${2:-}" = --worktree ]; then exit 0; fi ;;
  esac
  case "${1:-}" in
    "" | up | restart | down | status | logs | url) die "no stack configured (copy stack.example.conf to stack.local.conf)" ;;
  esac
else
  . "$CONFIG"
  STACK_ENV_STRIPPED="^(DB_PORT|WEB_API_URL|LANGSMITH_PROJECT|LANGCHAIN_PROJECT|[A-Z_]*_DATABASE_URL|$CREDENTIALS_URL_VAR)="
fi

held_locks=""
starting=""

cleanup() {
  local l
  if [ -n "$starting" ]; then stop_services "$starting" || true; fi
  while IFS= read -r l; do
    if [ -n "$l" ]; then rm -rf "$l"; fi
  done <<<"$held_locks"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

real_dir() { (cd "$1" 2>/dev/null && pwd -P); }

# Sets $context to worktree, main, or none, and $worktree to the worktree's realpath.
resolve_context() {
  local main_git common top
  context=none
  worktree=""
  main_git="$(real_dir "$MAIN/.git")" || return 0
  common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 0
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ "$(real_dir "$common")" = "$main_git" ] || return 0
  if [ "$(real_dir "$top")" = "$(real_dir "$MAIN")" ]; then
    context=main
  else
    context=worktree
    worktree="$(real_dir "$top")"
  fi
}

require_worktree() {
  resolve_context
  case "$context" in
    worktree) ;;
    main) die "no stack runs in the main checkout; run this from one of its worktrees" ;;
    *) die "no stack defined for this repo" ;;
  esac
}

require_worktree_or_main() {
  resolve_context
  [ "$context" != none ] || die "no stack defined for this repo"
}

web_port() { echo $((WEB_PORT_BASE + $1)); }
backend_port() { echo $((BACKEND_PORT_BASE + $1)); }
db_port() { echo $((DB_PORT_BASE + $1)); }
web_url() { echo "http://localhost:$(web_port "$1")"; }

container_name() { echo "$NAME_PREFIX-db-wt$1"; }
compose_project() { echo "$NAME_PREFIX-wt$1"; }

slot_dir() { echo "$REGISTRY/slot-$1"; }
log_file() { echo "$(slot_dir "$1")/logs/$2.log"; }
plist_file() { echo "$(slot_dir "$1")/$2.plist"; }
job_label() { echo "$LABEL_PREFIX.slot$1.$2"; }

registry_get() { cat "$(slot_dir "$1")/$2" 2>/dev/null || true; }

registry_set() {
  local f
  f="$(slot_dir "$1")/$2"
  printf '%s\n' "$3" >"$f.tmp"
  mv "$f.tmp" "$f"
}

registered() { [ -f "$(slot_dir "$1")/worktree" ]; }

slot_for_worktree() {
  local n
  for n in $SLOTS; do
    if registered "$n" && [ "$(registry_get "$n" worktree)" = "$1" ]; then
      echo "$n"
      return 0
    fi
  done
}

valid_slot() {
  case " $SLOTS " in
    *" $1 "*) [ -n "$1" ] ;;
    *) return 1 ;;
  esac
}

port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

slot_ports_busy() {
  port_listening "$(web_port "$1")" || port_listening "$(backend_port "$1")" || port_listening "$(db_port "$1")"
}

job_running() {
  local out
  out="$(launchctl print "$GUI_DOMAIN/$(job_label "$1" "$2")" 2>/dev/null)" || return 1
  case "$out" in
    *'state = running'*) return 0 ;;
  esac
  return 1
}

container_running() { [ "$(docker inspect -f '{{.State.Running}}' "$(container_name "$1")" 2>/dev/null)" = true ]; }

slot_state() {
  local n="$1"
  if [ ! -d "$(registry_get "$n" worktree)" ]; then
    echo orphan
  elif job_running "$n" backend && job_running "$n" web &&
    port_listening "$(backend_port "$n")" && port_listening "$(web_port "$n")" &&
    container_running "$n"; then
    echo running
  else
    echo stopped
  fi
}

time_left() {
  local deadline left
  deadline="$(registry_get "$1" deadline)"
  if [ -z "$deadline" ]; then
    echo -
    return 0
  fi
  left=$((deadline - $(date +%s)))
  if [ "$left" -le 0 ]; then
    echo expired
  else
    printf '%dh%02dm\n' $((left / 3600)) $((left % 3600 / 60))
  fi
}

branch_of() {
  [ -d "$1" ] || {
    echo -
    return 0
  }
  git -C "$1" symbolic-ref --short -q HEAD 2>/dev/null || echo "(detached)"
}

proc_start() { ps -o lstart= -p "$1" 2>/dev/null || true; }

lock_stale() {
  local lock="$1" pid start age
  pid="$(cat "$lock/pid" 2>/dev/null || true)"
  start="$(cat "$lock/start" 2>/dev/null || true)"
  if [ -z "$pid" ] || [ -z "$start" ]; then
    # A holder writes its pid and start time right after mkdir; give it a moment before calling it dead.
    age=$(($(date +%s) - $(stat -f %m "$lock" 2>/dev/null || date +%s)))
    [ "$age" -gt 5 ]
    return
  fi
  kill -0 "$pid" 2>/dev/null || return 0
  [ "$(proc_start "$pid")" != "$start" ]
}

# $1 is the lock dir, $2 how many seconds to wait for a live holder (default $LOCK_WAIT).
lock_acquire() {
  local lock="$1" wait="${2:-$LOCK_WAIT}" waited=0
  mkdir -p "$REGISTRY"
  until mkdir "$lock" 2>/dev/null; do
    if lock_stale "$lock"; then
      echo "stack: breaking stale lock $lock (pid $(cat "$lock/pid" 2>/dev/null || echo unknown))" >&2
      rm -rf "$lock"
      continue
    fi
    if [ "$waited" -ge "$wait" ]; then
      echo "stack: $lock is held by pid $(cat "$lock/pid" 2>/dev/null || echo unknown)" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  held_locks="$held_locks$lock"$'\n'
  echo $$ >"$lock/pid"
  proc_start $$ >"$lock/start"
}

lock_release() {
  local l rest=""
  rm -rf "$1"
  while IFS= read -r l; do
    if [ -n "$l" ] && [ "$l" != "$1" ]; then rest="$rest$l"$'\n'; fi
  done <<<"$held_locks"
  held_locks="$rest"
}

global_lock() { echo "$REGISTRY/global.lock"; }
slot_lock() { echo "$REGISTRY/slot-$1.lock"; }

# Sets $slot for worktree $1. Caller holds the global lock.
claim_slot() {
  local wt="$1" n
  slot="$(slot_for_worktree "$wt")"
  [ -z "$slot" ] || return 0
  for n in $SLOTS; do
    if registered "$n" || slot_ports_busy "$n"; then continue; fi
    mkdir -p "$(slot_dir "$n")/logs"
    registry_set "$n" worktree "$wt"
    slot="$n"
    return 0
  done
  echo "stack: all nine slots are taken:" >&2
  for n in $SLOTS; do
    if registered "$n"; then
      echo "  slot $n: $(registry_get "$n" worktree)" >&2
    else
      echo "  slot $n: ports $(web_port "$n")/$(backend_port "$n")/$(db_port "$n") in use outside /stack" >&2
    fi
  done
  exit 1
}

require_docker() { docker info >/dev/null 2>&1 || die "Docker is not running; start Docker Desktop, then retry"; }

main_db_healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$MAIN_CONTAINER" 2>/dev/null)" = healthy ]; }

main_select() {
  docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$MAIN_CONTAINER" \
    psql -U postgres -X -At -v ON_ERROR_STOP=1 -d "$1" -c "$2"
}

slot_psql() { docker exec -i "$(container_name "$1")" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -d "$2" -c "$3"; }

DATABASE_LIST_SQL="SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1"

# Database names the checkout at $1 migrates, derived like local_db.py's ini_database_name.
app_databases() {
  find "$1/backend/src" -name 'alembic*.ini' | sed -E 's#^.*/src/(apps|schemas)/([^/]+)/.*$#\2#' | sort -u
}

env_value() {
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

compose_db() {
  local n="$1" wt="$2" override
  shift 2
  # Compose never interpolates keys, so the service name is filled in here.
  override="$(slot_dir "$n")/compose.override.yml"
  sed "s/__DB_SERVICE__/$DB_SERVICE/" "$OVERRIDE" >"$override"
  STACK_CONTAINER="$(container_name "$n")" STACK_DB_PORT="$(db_port "$n")" docker compose -p "$(compose_project "$n")" \
    -f "$wt/backend/docker-compose.yml" -f "$override" "$@"
}

remove_slot_docker() {
  local label ids
  label="com.docker.compose.project=$(compose_project "$1")"
  ids="$(docker ps -aq --filter "label=$label")"
  if [ -n "$ids" ]; then docker rm -f $ids >/dev/null; fi
  ids="$(docker volume ls -q --filter "label=$label")"
  if [ -n "$ids" ]; then docker volume rm -f $ids >/dev/null; fi
}

check_shared_credentials() {
  local env_file="$1" ours theirs
  ours="$(env_value "$env_file" "$ENCRYPTION_KEY_VAR")"
  theirs="$(env_value "$ENCRYPTION_KEY_FILE" "$ENCRYPTION_KEY_VAR")"
  [ -n "$theirs" ] || die "$ENCRYPTION_KEY_VAR is missing from $ENCRYPTION_KEY_FILE; cannot share main's credentials database"
  [ "$ours" = "$theirs" ] ||
    die "$ENCRYPTION_KEY_VAR in $env_file differs from $ENCRYPTION_KEY_FILE; the shared credentials database would mark main's integrations needs_reauth"
}

# Streams main's cluster into slot $1's fresh container. Returns 1 on any doubt.
restore_from_main() {
  local n="$1" log src dst db status
  log="$(log_file "$n" db)"
  src="$(main_select postgres "$DATABASE_LIST_SQL")" || return 1
  set +e
  docker exec "$MAIN_CONTAINER" pg_dumpall -U postgres 2>>"$log" |
    awk -v trailer="$DUMP_TRAILER" '
      $0 == "CREATE ROLE postgres;" { next }
      index($0, trailer) { seen = 1 }
      { print }
      END { exit !seen }' |
    docker exec -i "$(container_name "$n")" psql -U postgres -X -q -v ON_ERROR_STOP=1 -d postgres >/dev/null 2>>"$log"
  status="${PIPESTATUS[*]}"
  set -e
  if [ "$status" != "0 0 0" ]; then
    echo "stack: restore failed (pg_dumpall, cluster dump complete trailer, psql exit codes: $status); see $log" >&2
    return 1
  fi
  dst="$(slot_psql "$n" postgres "$DATABASE_LIST_SQL")" || return 1
  if [ "$src" != "$dst" ]; then
    echo "stack: restored databases differ from main's (did main change mid-copy?)" >&2
    return 1
  fi
  for db in $(app_databases "$MAIN"); do
    if ! printf '%s\n' "$dst" | grep -qx "$db"; then
      echo "stack: main's database has no $db; run make start in $MAIN first" >&2
      return 1
    fi
  done
}

# Runs only in slot $1's copy, before any migration or service touches it. The copied
# credentials database is dropped because the stack shares main's instead.
# slot_psql's docker exec -i would otherwise swallow the loop's here-string.
neutralize_copy() {
  local n="$1" db sql
  while IFS='|' read -r db sql; do
    [ -n "$db" ] || continue
    slot_psql "$n" "$db" "$sql" </dev/null || return 1
  done <<<"$NEUTRALIZE_SQL"
  slot_psql "$n" postgres "DROP DATABASE $CREDENTIALS_DB" </dev/null
}

assert_no_live_work() {
  local n="$1" db label sql count counts="" live=""
  while IFS='|' read -r db label sql; do
    [ -n "$db" ] || continue
    count="$(slot_psql "$n" "$db" "$sql" </dev/null)" || die "slot $n: could not count live work in the copy"
    counts="${counts:+$counts, }$count $label"
    [ "$count" = 0 ] || live=1
  done <<<"$LIVE_WORK_SQL"
  [ -z "$live" ] || die "slot $n copy still has live work ($counts); run /stack restart to reseed"
}

# Revision-skew check, provision, and migrate via the worktree's own local_db.py, with
# CONTAINER pointed at the slot so its docker exec provisioning never reaches main's container.
migrate_slot() {
  local n="$1" wt="$2" env_file="$3" main_rev=""
  if main_db_healthy; then
    main_rev="$(main_select "$CREDENTIALS_DB" "SELECT version_num FROM alembic_version" 2>/dev/null | head -n 1)" || main_rev=""
  fi
  echo "stack: provisioning and migrating slot $n ($CREDENTIALS_DB excluded)..."
  (cd "$wt/backend" && uv run --frozen --env-file "$env_file" python - "$(container_name "$n")" "$main_rev" "$CREDENTIALS_DB") <<'PY' ||
import importlib.util
import sys

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util import CommandError

container, main_credentials_rev, credentials_db = sys.argv[1], sys.argv[2], sys.argv[3]
spec = importlib.util.spec_from_file_location("local_db", "scripts/local_db.py")
local_db = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local_db)
local_db.CONTAINER = container
local_db.wait_for_postgres()


def known(script, rev):
    try:
        return script.get_revision(rev) is not None
    except CommandError:
        return False


inis = local_db.discover_alembic_inis()
credentials = [i for i in inis if local_db.ini_database_name(i) == credentials_db]
apps = [i for i in inis if local_db.ini_database_name(i) != credentials_db]

existing = set(local_db._psql("-tAc", "SELECT datname FROM pg_database").split())
for ini in apps:
    db = local_db.ini_database_name(ini)
    if db not in existing or not local_db._psql("-d", db, "-tAc", "SELECT to_regclass('alembic_version')").strip():
        continue
    script = ScriptDirectory.from_config(Config(str(ini)))
    for rev in local_db._psql("-d", db, "-tAc", "SELECT version_num FROM alembic_version").split():
        if not known(script, rev):
            sys.exit(f"stack: {db} is at {rev}, unknown to this branch: main's database is ahead of this branch — rebase, then /stack restart")

if credentials and main_credentials_rev:
    script = ScriptDirectory.from_config(Config(str(credentials[0])))
    if main_credentials_rev not in script.get_heads() and known(script, main_credentials_rev):
        print(
            f"stack: warning: this branch's credentials migrations are ahead of main's ({main_credentials_rev});"
            " they are never applied here, so integrations may misbehave until main migrates",
            file=sys.stderr,
        )

created = local_db.provision()
print(f"  provisioned ({len(created)} created: {', '.join(created) or 'none'})")
local_db.migrate(apps)
PY
    die "slot $n: provision or migrate failed (see above); rebase, then /stack restart"
}

# Brings up slot $1's Postgres for worktree $2, seeding it once from main, then migrates
# under env file $3. Exits non-zero on any failure; never writes main's database.
db_start() {
  local n="$1" wt="$2" env_file="$3" source=empty fresh="" log
  log="$(log_file "$n" db)"
  [ -f "$env_file" ] || die "missing $env_file"
  check_shared_credentials "$env_file"
  if [ -z "$(registry_get "$n" seeded)" ]; then
    remove_slot_docker "$n"
  fi
  echo "stack: starting Postgres for slot $n on port $(db_port "$n")..."
  compose_db "$n" "$wt" up -d --wait --wait-timeout "$DB_WAIT" >>"$log" 2>&1 ||
    die "slot $n: Postgres did not become healthy; see $log"
  if [ -z "$(registry_get "$n" seeded)" ]; then
    if main_db_healthy; then
      echo "stack: seeding slot $n from main's database..."
      if ! restore_from_main "$n" || ! neutralize_copy "$n"; then
        remove_slot_docker "$n"
        die "slot $n: seed failed and its volume was destroyed; retry /stack up"
      fi
      source=main
    else
      echo "stack: warning: main's database is not running; slot $n starts empty" >&2
    fi
    registry_set "$n" seeded "$source"
    fresh=1
  fi
  main_db_healthy ||
    echo "stack: warning: main's database is down, so integrations (shared credentials) are unavailable" >&2
  migrate_slot "$n" "$wt" "$env_file"
  if [ -n "$fresh" ]; then
    rm -f "$(slot_dir "$n")/seeded"
    assert_no_live_work "$n"
    registry_set "$n" seeded "$source"
  fi
}

bootout_job() {
  local label="$GUI_DOMAIN/$(job_label "$1" "$2")" waited=0
  launchctl bootout "$label" 2>/dev/null || true
  while launchctl print "$label" >/dev/null 2>&1 && [ "$waited" -lt "$STOP_WAIT" ]; do
    sleep 1
    waited=$((waited + 1))
  done
}

stop_services() {
  bootout_job "$1" web
  bootout_job "$1" backend
}

# Caller holds slot $1's lock.
# Caller holds slot $1's lock. With Docker down, stops the launchd jobs and leaves the slot
# registered so a later down, or the orphan reaper, removes the container and volume.
stop_without_docker() {
  docker info >/dev/null 2>&1 && return 0
  stop_services "$1"
  launchctl bootout "$GUI_DOMAIN/$(job_label "$1" timer)" 2>/dev/null || true
  die "Docker is not running; stopped slot $1's services, but its container and volume stay until Docker is up (rerun down, or the next /stack command reaps it once its worktree is gone)"
}

teardown_slot() {
  local n="$1"
  stop_services "$n"
  bootout_job "$n" timer
  remove_slot_docker "$n"
  rm -rf "$(slot_dir "$n")"
}

# Caller holds the global lock.
reap_orphans() {
  local n wt
  for n in $SLOTS; do
    registered "$n" || continue
    wt="$(registry_get "$n" worktree)"
    [ ! -d "$wt" ] || continue
    lock_acquire "$(slot_lock "$n")" 5 || continue
    teardown_slot "$n"
    lock_release "$(slot_lock "$n")"
    echo "stack: reaped slot $n (worktree gone: $wt)"
  done
}

set_deadline() { registry_set "$1" deadline $(($(date +%s) + STACK_TTL)); }

expired() {
  local deadline
  deadline="$(registry_get "$1" deadline)"
  [ -n "$deadline" ] && [ "$(date +%s)" -ge "$deadline" ]
}

slot_active() { job_running "$1" backend || job_running "$1" web || container_running "$1"; }

# Caller holds slot $1's lock. Keeps the volume, registry entry, and slot.
stop_expired() {
  stop_services "$1"
  docker stop "$(container_name "$1")" >/dev/null 2>&1 || true
  echo "stack: slot $1 passed its 12-hour deadline; stopped (data and slot kept, /stack up to resume)"
}

start_timer() {
  local n="$1"
  bootout_job "$n" timer
  write_plist "$n" timer "$REGISTRY" "PATH=$PATH" "HOME=$HOME" -- /bin/bash "$SCRIPT_DIR/stack.sh" expire "$n"
  launchctl bootstrap "$GUI_DOMAIN" "$(plist_file "$n" timer)" >>"$(log_file "$n" timer)" 2>&1 ||
    echo "stack: warning: slot $n's timer job did not load (see $(log_file "$n" timer)); any /stack command still stops it once expired" >&2
}

# Stops every expired, still-running stack except slot $1, which the caller is starting.
sweep_expired() {
  local n
  for n in $SLOTS; do
    [ "$n" != "${1:-}" ] || continue
    registered "$n" && [ -d "$(registry_get "$n" worktree)" ] && expired "$n" && slot_active "$n" || continue
    lock_acquire "$(slot_lock "$n")" 5 || continue
    if registered "$n" && expired "$n"; then
      stop_expired "$n"
      bootout_job "$n" timer
    fi
    lock_release "$(slot_lock "$n")"
  done
}

# Run by slot $1's launchd timer job, with no worktree as cwd.
cmd_expire() {
  local n="${1:-}" self
  valid_slot "$n" || exit 2
  self="$GUI_DOMAIN/$(job_label "$n" timer)"
  registered "$n" || exec launchctl bootout "$self"
  expired "$n" || return 0
  lock_acquire "$(slot_lock "$n")" 5 || return 0
  registered "$n" || {
    lock_release "$(slot_lock "$n")"
    exec launchctl bootout "$self"
  }
  expired "$n" || return 0
  stop_expired "$n"
  # Booting out our own job signals this process, so the lock goes first; a concurrent up
  # boots this job out and waits for it to exit before bootstrapping its replacement.
  lock_release "$(slot_lock "$n")"
  exec launchctl bootout "$self"
}

start_docker() {
  local waited=0
  docker info >/dev/null 2>&1 && return 0
  echo "stack: starting Docker Desktop..."
  open -a Docker || die "Docker is not running and Docker Desktop would not open"
  until docker info >/dev/null 2>&1; do
    [ "$waited" -lt "$DOCKER_WAIT" ] || die "Docker did not start within ${DOCKER_WAIT}s; start Docker Desktop, then retry"
    sleep 2
    waited=$((waited + 2))
  done
}

preflight() {
  local wt="$1" tool n
  for tool in uv pnpm node jq curl; do
    command -v "$tool" >/dev/null || die "$tool is not on PATH"
  done
  [ -f "$MAIN/backend/.env.docker" ] || die "main has no backend/.env.docker; run make env in $MAIN/backend"
  [ -f "$MAIN/web/.env.local" ] || die "main has no web/.env.local; run pnpm env:pull in $MAIN/web"
  for n in $SLOTS; do
    grep -q "\"http://localhost:$(web_port "$n")\"" "$wt/backend/langgraph.json" 2>/dev/null ||
      die "this branch's backend/langgraph.json predates per-slot local ports; rebase onto main"
  done
  [ -f "$wt/backend/scripts/local_db.py" ] || die "branch predates backend/scripts/local_db.py — rebase"
  start_docker
}

# Exits after printing $svc's log tail; the EXIT trap stops the half-started services.
service_fail() {
  local n="$1" svc="$2" f
  f="$(log_file "$n" "$svc")"
  echo "stack: slot $n: $svc $3" >&2
  echo "--- last $FAIL_LINES lines of $f ---" >&2
  tail -n "$FAIL_LINES" "$f" >&2 || true
  echo "stack: web and backend stopped; slot, database, and logs kept. Fix the cause (often: rebase), then /stack restart; /stack logs shows more" >&2
  exit 1
}

run_phase() {
  local n="$1" svc="$2" what="$3"
  shift 3
  "$@" >>"$(log_file "$n" "$svc")" 2>&1 || service_fail "$n" "$svc" "$what failed"
}

await_ports_free() {
  local n="$1" port waited
  for port in "$(web_port "$n")" "$(backend_port "$n")"; do
    waited=0
    while port_listening "$port"; do
      [ "$waited" -lt "$STOP_WAIT" ] || die "slot $n: port $port is in use outside /stack; free it, then /stack restart"
      sleep 1
      waited=$((waited + 1))
    done
  done
}

write_env_files() {
  local n="$1" wt="$2" src="$MAIN/backend/.env.docker" tmp var project
  tmp="$(slot_dir "$n")/env.tmp"
  (
    umask 077
    {
      awk -v re="$STACK_ENV_STRIPPED" '$0 !~ re' "$src"
      echo "DB_PORT=$(db_port "$n")"
      echo "WEB_API_URL=$(web_url "$n")"
      echo "$CREDENTIALS_URL_VAR=$CREDENTIALS_URL"
      for var in LANGSMITH_PROJECT LANGCHAIN_PROJECT; do
        project="$(env_value "$src" "$var")"
        if [ -n "$project" ]; then echo "$var=$project-wt$n"; fi
      done
    } >"$tmp"
  )
  mv "$tmp" "$wt/backend/.env.stack"
  jq '.env = ".env.stack"' "$wt/backend/langgraph.json" >"$tmp"
  mv "$tmp" "$wt/backend/langgraph.local.json"
  if [ ! -e "$wt/web/.env.local" ]; then ln -sfn "$MAIN/web/.env.local" "$wt/web/.env.local"; fi
}

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# write_plist <slot> <svc> <workdir> [NAME=value ...] -- <program> [arg ...]
write_plist() {
  local n="$1" svc="$2" dir="$3" log arg run='  <key>RunAtLoad</key><true/>'
  shift 3
  log="$(xml_escape "$(log_file "$n" "$svc")")"
  # The timer's first check waits a full interval: at load time its starter still holds the slot lock.
  if [ "$svc" = timer ]; then run='  <key>RunAtLoad</key><false/>
  <key>StartInterval</key><integer>60</integer>'; fi
  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(job_label "$n" "$svc")</string>
  <key>WorkingDirectory</key><string>$(xml_escape "$dir")</string>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
$run
  <key>KeepAlive</key><false/>
  <key>AbandonProcessGroup</key><false/>
  <key>EnvironmentVariables</key>
  <dict>
EOF
    while [ "$1" != -- ]; do
      printf '    <key>%s</key><string>%s</string>\n' "${1%%=*}" "$(xml_escape "${1#*=}")"
      shift
    done
    shift
    printf '  </dict>\n  <key>ProgramArguments</key>\n  <array>\n'
    for arg in "$@"; do printf '    <string>%s</string>\n' "$(xml_escape "$arg")"; done
    printf '  </array>\n</dict>\n</plist>\n'
  } >"$(plist_file "$n" "$svc")"
}

start_job() {
  local n="$1" svc="$2"
  write_plist "$@"
  launchctl bootstrap "$GUI_DOMAIN" "$(plist_file "$n" "$svc")" >>"$(log_file "$n" "$svc")" 2>&1 ||
    service_fail "$n" "$svc" "launchctl bootstrap failed"
}

# The web job runs next dev directly: the app's own dev script first rebuilds a tracked
# generated file, which would dirty the worktree and block /land's removal.
start_services() {
  local n="$1" wt="$2"
  start_job "$n" backend "$wt/backend" "PATH=$PATH" "HOME=$HOME" -- \
    "$(command -v uv)" run --frozen --env-file .env.stack langgraph dev --config langgraph.local.json \
    --no-browser --n-jobs-per-worker 10 --port "$(backend_port "$n")"
  start_job "$n" web "$wt/web" "PATH=$PATH" "HOME=$HOME" \
    "AUTH_URL=$(web_url "$n")" "API_URL=http://127.0.0.1:$(backend_port "$n")" -- \
    "$wt/web/node_modules/.bin/next" dev -p "$(web_port "$n")"
}

# Both dev servers move to another port when theirs is taken, so only the expected port counts.
await_service() {
  local n="$1" svc="$2" port="$3" probe="${4:-}" waited=0
  echo "stack: waiting for $svc on port $port..."
  until port_listening "$port" && { [ -z "$probe" ] || curl -sf -m 5 -o /dev/null "$probe"; }; do
    if [ "$waited" -ge 3 ] && ! job_running "$n" "$svc"; then
      service_fail "$n" "$svc" "exited before answering on port $port"
    fi
    [ "$waited" -lt "$SERVICE_WAIT" ] ||
      service_fail "$n" "$svc" "did not answer on port $port within ${SERVICE_WAIT}s"
    sleep 1
    waited=$((waited + 1))
  done
  job_running "$n" "$svc" || service_fail "$n" "$svc" "is not running, yet port $port answers; something else holds it"
}

report() {
  local n="$1"
  echo "  web:      $(web_url "$n")"
  echo "  backend:  http://127.0.0.1:$(backend_port "$n")"
  echo "  postgres: 127.0.0.1:$(db_port "$n")"
  echo "  slot $n, stops in $(time_left "$n")"
  if [ "$(registry_get "$n" seeded)" = main ]; then
    echo "  The copy's background work is neutralized in this stack; integrations use main's credentials."
  fi
}

# $1 is up or restart; restart never short-circuits on a running stack.
start_stack() {
  local mode="$1" wt n weblog
  require_worktree
  wt="$worktree"
  preflight "$wt"
  lock_acquire "$(global_lock)" || die "cannot take the global lock"
  reap_orphans
  sweep_expired "$(slot_for_worktree "$wt")"
  claim_slot "$wt"
  n="$slot"
  lock_acquire "$(slot_lock "$n")" 2 || die "this worktree's stack (slot $n) is busy with another /stack command; retry when it finishes"
  lock_release "$(global_lock)"
  if [ "$mode" = up ] && [ "$(slot_state "$n")" = running ]; then
    set_deadline "$n"
    start_timer "$n"
    echo "stack: slot $n is already running; clock reset"
    report "$n"
    return 0
  fi
  starting="$n"
  echo "stack: slot $n ($wt)"
  stop_services "$n"
  await_ports_free "$n"
  weblog="$(log_file "$n" web)"
  : >"$(log_file "$n" backend)"
  : >"$weblog"
  write_env_files "$n" "$wt"
  echo "stack: installing backend dependencies..."
  run_phase "$n" backend "uv sync --frozen" uv sync --frozen --directory "$wt/backend"
  echo "stack: installing web dependencies..."
  run_phase "$n" web "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile --dir "$wt/web"
  db_start "$n" "$wt" "$wt/backend/.env.stack"
  echo "stack: checking web env..."
  node "$wt/web/scripts/check-env.mjs" 2>&1 | tee -a "$weblog" || service_fail "$n" web "check-env.mjs failed"
  echo "stack: starting backend and web..."
  start_services "$n" "$wt"
  await_service "$n" backend "$(backend_port "$n")" "http://127.0.0.1:$(backend_port "$n")/ok"
  await_service "$n" web "$(web_port "$n")"
  set_deadline "$n"
  start_timer "$n"
  starting=""
  echo "stack: slot $n is up"
  report "$n"
}

cmd_check() {
  resolve_context
  [ "$context" = worktree ]
}

cmd_status() {
  local n any=""
  require_worktree_or_main
  sweep_expired
  for n in $SLOTS; do
    registered "$n" || continue
    if [ -z "$any" ]; then
      printf '%-4s %-8s %-8s %-5s %-7s %-5s %-30s %s\n' SLOT STATE LEFT WEB BACKEND DB BRANCH WORKTREE
      any=1
    fi
    printf '%-4s %-8s %-8s %-5s %-7s %-5s %-30s %s\n' "$n" "$(slot_state "$n")" "$(time_left "$n")" \
      "$(web_port "$n")" "$(backend_port "$n")" "$(db_port "$n")" \
      "$(branch_of "$(registry_get "$n" worktree)")" "$(registry_get "$n" worktree)"
  done
  [ -n "$any" ] || echo "no stacks"
}

cmd_logs() {
  local n svc f any=""
  require_worktree
  sweep_expired
  n="$(slot_for_worktree "$worktree")"
  [ -n "$n" ] || die "no stack for this worktree; run /stack up"
  for svc in db backend web timer; do
    f="$(log_file "$n" "$svc")"
    [ -f "$f" ] || continue
    echo "== $svc ($f) =="
    tail -n "$LOG_LINES" "$f"
    any=1
  done
  [ -n "$any" ] || echo "no logs yet for slot $n"
}

cmd_url() {
  local n
  require_worktree
  sweep_expired
  n="$(slot_for_worktree "$worktree")"
  [ -n "$n" ] || die "no stack for this worktree; run /stack up"
  [ "$(slot_state "$n")" = running ] || die "slot $n is not running; run /stack up"
  web_url "$n"
}

# A worktree already gone from disk is matched by its parent's realpath, else literally.
worktree_key() {
  local parent
  if real_dir "$1"; then return 0; fi
  if parent="$(real_dir "$(dirname "$1")")"; then
    echo "$parent/$(basename "$1")"
  else
    echo "$1"
  fi
}

remove_slot() {
  local n="$1" wt
  lock_acquire "$(global_lock)" || die "cannot take the global lock"
  lock_acquire "$(slot_lock "$n")" || die "cannot take slot $n's lock"
  stop_without_docker "$n"
  wt="$(registry_get "$n" worktree)"
  teardown_slot "$n"
  echo "removed slot $n ($wt)"
}

cmd_down_worktree() {
  local wt n
  wt="$(worktree_key "$1")"
  n="$(slot_for_worktree "$wt")"
  [ -n "$n" ] || return 0
  remove_slot "$n"
}

cmd_down() {
  if [ "$#" -eq 2 ] && [ "$1" = --worktree ]; then
    cmd_down_worktree "$2"
    return
  fi
  if [ "$#" -eq 0 ]; then
    require_worktree
  elif [ "$#" -eq 1 ] && valid_slot "$1"; then
    require_worktree_or_main
  else
    echo "usage: stack.sh down [slot | --worktree <path>]  (slot is 1-9)" >&2
    exit 2
  fi
  local n="${1:-}"
  if [ -z "$n" ]; then
    n="$(slot_for_worktree "$worktree")"
    if [ -z "$n" ]; then
      echo "no stack for this worktree"
      return 0
    fi
  elif ! registered "$n"; then
    echo "slot $n has no stack"
    return 0
  fi
  remove_slot "$n"
}

cmd="${1:-}"
case "$cmd" in
  -h | --help) usage ;;
  "" | status) cmd_status ;;
  up) start_stack up ;;
  restart) start_stack restart ;;
  down)
    shift
    cmd_down "$@"
    ;;
  logs) cmd_logs ;;
  url) cmd_url ;;
  check) cmd_check ;;
  expire) cmd_expire "${2:-}" ;;
  *)
    usage >&2
    exit 2
    ;;
esac
