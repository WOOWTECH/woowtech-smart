#!/bin/bash
# Run a long job (Gradle build, Metro, dev daemon) detached, with a durable log.
#
#   run-bg.sh <name> <command...>
#   tail -f ~/.local/share/woowtech-smart/logs/<name>.log
#
# The last line of the log is `EXIT=<code>` once the job ends; `<name>.pid`
# holds the process id while it runs.
#
# WHY
# ---
# Jobs started as Claude Code background tasks die when Claude Code restarts,
# and their logs lived in a session scratchpad that is wiped on restart. On
# 2026-09-24 the Mac rebooted mid Android build and the only record of how far
# the build had got went with the scratchpad. Logs here survive both; the new
# session (setsid) also means a Claude Code restart alone no longer kills the
# job. A machine reboot still does — the log then shows where it stopped.
set -euo pipefail

[ $# -ge 2 ] || { echo "usage: run-bg.sh <name> <command...>" >&2; exit 2; }
name=$1; shift
dir="$HOME/.local/share/woowtech-smart/logs"
mkdir -p "$dir"
log="$dir/$name.log"

if [ -f "$dir/$name.pid" ] && kill -0 "$(cat "$dir/$name.pid")" 2>/dev/null; then
  echo "$name is already running (pid $(cat "$dir/$name.pid")) -> $log" >&2
  exit 1
fi

{ echo "=== $(date '+%F %T') start: $*"; } > "$log"
perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' \
  bash -c '"$@"; rc=$?; echo "EXIT=$rc"; exit $rc' _ "$@" >>"$log" 2>&1 </dev/null &
echo "$!" > "$dir/$name.pid"
echo "started $name (pid $!) -> $log"
