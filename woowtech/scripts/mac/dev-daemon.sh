#!/bin/bash
# Lean Paseo dev daemon for simulator testing on this Mac.
#
# Same environment as the repo's scripts/dev-daemon.sh (dev home in
# .dev/paseo-home, listen 127.0.0.1:6768, CORS *), minus two things:
#
#   - No protocol/client tsc watchers. Upstream runs three processes via
#     `dev:server:watch`; we are testing the app, not editing daemon code, and
#     this machine has 8 GB of RAM with swap already near full. Only the
#     server's tsx runner is started.
#   - No `build:server-deps` on every launch. Run it (or build:app-deps plus
#     build:relay, which covers the same packages) once beforehand.
#
# This fork ships without the local speech runtime (sherpa-onnx-node), so the
# daemon configures no local speech and downloads no models. Upstream Paseo
# downloads ~985 MB of English-only speech models on first start instead.
set -e

ROOT="$HOME/projects/woowtech-smart"
. "$HOME/.local/share/woowtech-smart/env.sh"
cd "$ROOT"
export PATH="$ROOT/node_modules/.bin:$PATH"

# shellcheck source=/dev/null
source scripts/dev-home.sh
export PASEO_LISTEN="${PASEO_LISTEN:-127.0.0.1:6768}"
configure_dev_paseo_home
export PASEO_CORS_ORIGINS="${PASEO_CORS_ORIGINS:-*}"

echo "home=${PASEO_HOME} listen=${PASEO_LISTEN}"
exec npm run dev:server:raw
