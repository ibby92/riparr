#!/bin/bash
# Runs the web server and the worker side by side. If either one exits, the
# other is stopped and the container exits so the restart policy can take over.
set -euo pipefail

umask "${UMASK:-002}"

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  groupmod -o -g "$PGID" node
  usermod -o -u "$PUID" node >/dev/null
  chown node:node /config
  [ -f /config/riparr.db ] && chown node:node /config/riparr.db*
  exec gosu node "$0" "$@"
fi

node /app/worker.mjs &
worker=$!
node /app/server.js &
server=$!

trap 'kill -TERM "$worker" "$server" 2>/dev/null' TERM INT

set +e
wait -n "$worker" "$server"
status=$?
kill -TERM "$worker" "$server" 2>/dev/null
wait
exit "$status"
