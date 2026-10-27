#!/bin/bash
# deploy-web.sh: build woowtech smart's web app and upload it to Cloudflare Pages.
#
# The web app is packages/app's `expo export --platform web`, served by the Pages project
# woowtech-smart-web (WOOWTECH's Cloudflare account) at https://smart.woowtech.io.
# woowtech/README.md section 27 has the whole procedure, the owner's steps and the rollback.
#
#   WOOW_DRY_RUN=1 woowtech/scripts/deploy-web.sh   # build and check; wrangler never runs
#   woowtech/scripts/deploy-web.sh --preview        # upload to the preview branch
#   woowtech/scripts/deploy-web.sh                  # upload to production (branch main)
#   npm run deploy:web --workspace=@getpaseo/app    # the same as the line above
#
# Uploads use the owner's wrangler login in a directory of its own,
# ~/.local/share/woowtech-smart/wrangler-pages, made once with only the account:read, user:read
# and pages:write scopes. Every run checks those scopes with `wrangler whoami --json`, and no run
# logs out (owner decision O12, 2026-10-27). The trade-off the owner accepted: while that login
# is valid, any agent on this Mac can deploy to production.
#
# Before anything is uploaded: the commit is clean and on an origin branch, the export passes
# woowtech/web/check-export.mjs and its baseline (woowtech/web/export-baseline.json), wrangler is
# exactly WRANGLER_VERSION, and the login can use WOOWTECH's account, the only one any call runs
# for (CLOUDFLARE_ACCOUNT_ID).
#
# Settings (environment variables):
#   WOOW_CONFIRM_SHA=<7 or more characters of HEAD>  confirms the commit without a prompt. With
#       neither this nor a terminal (an agent), a production upload goes ahead unconfirmed; from
#       a terminal it asks for the first 7 characters.
#   WOOW_FRESH_INSTALL=1   runs `npm ci` first, unless node_modules is already npm ci's install of
#       this package-lock.json (node_modules/.woow-npm-ci). Only in a linked worktree, such as
#       ~/projects/woowtech-smart-web-deploy: npm ci replaces node_modules.
#   WOOW_ALLOW_DIRTY=1     with WOOW_DRY_RUN=1 only (the local E2E): skips the clean and pushed
#       checks.
#   WOOW_HEAVY_LABEL       heavy.sh label for npm ci and the build (default web-export).
#   WOOW_NODE22_BIN        Node 22 to put first on PATH when node is not 22 ("" for none).
#   WOOW_VERIFY_ATTEMPTS, WOOW_VERIFY_WAIT  how often and how many seconds apart verify-live.mjs
#       checks the site after an upload (3, 20).
#   WOOW_HEAVY, WOOW_WRANGLER, WOOW_TTY  stand-ins for woowtech/web-deploy.test.mjs.
#
# Exit codes: 0 done; 2 a check before the build, or the confirmation; 3 npm ci, the build or
# check-export; 4 wrangler (version, login, scopes, account, project); 5 the upload; 6 the check
# after the upload (it prints how to roll back); 75 heavy.sh gave up waiting for its lock.
set -euo pipefail

PROJECT=woowtech-smart-web
ACCOUNT_ID=9c27f623ee596e0b67be56263bcb1974
SITE_ORIGIN=https://smart.woowtech.io
PAGES_DEV_ORIGIN=https://woowtech-smart-web.pages.dev
REPORT_URL=https://reports.woowtech.io/v1/ai-content-reports
# 2026-10-08. It has `login --device`, `login --scopes` and `whoami --json` (README section 27).
WRANGLER_VERSION=4.149.0
WRANGLER_HOME=$HOME/.local/share/woowtech-smart/wrangler-pages
ALLOWED_SCOPES="account:read user:read pages:write offline_access"
OUT_ROOT=$HOME/.local/share/woowtech-smart/web-dist
HEAVY=${WOOW_HEAVY:-$HOME/.local/share/woowtech-smart/coord/bin/heavy.sh}
HEAVY_LABEL=${WOOW_HEAVY_LABEL:-web-export}
NODE22_BIN=${WOOW_NODE22_BIN-/opt/homebrew/opt/node@22/bin}
VERIFY_ATTEMPTS=${WOOW_VERIFY_ATTEMPTS:-3}
VERIFY_WAIT=${WOOW_VERIFY_WAIT:-20}

say() { printf 'deploy-web: %s\n' "$*"; }
die() {
  local code=$1
  shift
  printf 'deploy-web: %s\n' "$*" >&2
  exit "$code"
}
usage() { sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; }

# flag <name>: true when the variable is 1, false when it is unset, empty or 0.
flag() {
  local value
  eval "value=\${$1:-}"
  case "$value" in
    1) return 0 ;;
    '' | 0) return 1 ;;
    *) die 2 "$1 must be 1 or unset, not \"$value\"" ;;
  esac
}

MODE=production
while [ $# -gt 0 ]; do
  case "$1" in
    --preview) MODE=preview ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die 2 "unknown argument $1 (see --help)" ;;
  esac
  shift
done
if flag WOOW_DRY_RUN; then MODE=dry-run; fi
if [ -n "${WOOW_TTY:-}" ] && [ -z "${WOOW_WRANGLER:-}" ]; then
  die 2 "WOOW_TTY only works with a stand-in wrangler (WOOW_WRANGLER), in tests"
fi
ALLOW_DIRTY=false
if flag WOOW_ALLOW_DIRTY; then
  if [ "$MODE" != dry-run ]; then die 2 "WOOW_ALLOW_DIRTY=1 is only for WOOW_DRY_RUN=1 (the local E2E)"; fi
  ALLOW_DIRTY=true
fi
FRESH_INSTALL=false
if flag WOOW_FRESH_INSTALL; then FRESH_INSTALL=true; fi

REPO=$(cd "$(dirname "$0")/../.." && pwd -P)
if [ "$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null || true)" != "$REPO" ]; then
  die 2 "$REPO is not the top of a git worktree"
fi
# Before any `cd` into an empty directory, where git has no repository.
SHA=$(git -C "$REPO" rev-parse HEAD)
SHORT=$(git -C "$REPO" rev-parse --short=12 HEAD)
SHA7=${SHA:0:7}
MSG=$(git -C "$REPO" log -1 --format=%s)

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true; }
# CI already runs Node 22; this Mac's default node is 24.
NODE_MAJOR=$(node_major)
if [ "$NODE_MAJOR" != 22 ] && [ -n "$NODE22_BIN" ] && [ -d "$NODE22_BIN" ]; then
  PATH="$NODE22_BIN:$PATH"
  export PATH
  NODE_MAJOR=$(node_major)
fi
if [ "$NODE_MAJOR" != 22 ]; then
  die 2 "Node 22 is needed, node is $(node -v 2>/dev/null || echo missing): source woowtech/scripts/mac/env.sh or set WOOW_NODE22_BIN"
fi

# Only the owner's login in WRANGLER_HOME: no API token or key from the caller's environment.
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CF_API_TOKEN CF_API_KEY CF_EMAIL CF_ACCOUNT_ID
# Set by `npm run`; npx would look for wrangler in the repository instead of WRANGLER_VERSION.
unset npm_config_local_prefix
export CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID WRANGLER_SEND_METRICS=false EXPO_NO_TELEMETRY=1
TMP=$(mktemp -d "${TMPDIR:-/tmp}/woowtech-deploy-web.XXXXXX")
# An empty cache: `pages project list` and `pages deployment list` read the account id from
# wrangler's cache before the environment, and the cache is otherwise found in node_modules/.cache.
WRANGLER_CACHE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/woowtech-wrangler-cache.XXXXXX")
export WRANGLER_CACHE_DIR
trap 'rm -rf "$TMP" "$WRANGLER_CACHE_DIR"' EXIT

# wrangler, each call in a new empty directory: wrangler picks its profile by the working
# directory, and npx must not find the repository's own wrangler.
wr() {
  local dir
  dir=$(mktemp -d "$TMP/wrangler.XXXXXX") || return 1
  if [ -n "${WOOW_WRANGLER:-}" ]; then
    (cd "$dir" && XDG_CONFIG_HOME="$WRANGLER_HOME" "$WOOW_WRANGLER" "$@")
  else
    (cd "$dir" && XDG_CONFIG_HOME="$WRANGLER_HOME" npx --yes "wrangler@$WRANGLER_VERSION" "$@")
  fi
}

# run_heavy <what> <command...>: one heavy job through heavy.sh.
run_heavy() {
  local what=$1 rc=0
  shift
  "$HEAVY" run "$HEAVY_LABEL" -- "$@" || rc=$?
  if [ "$rc" -eq 75 ]; then die 75 "heavy.sh gave up waiting for its lock ($what)"; fi
  if [ "$rc" -ne 0 ]; then die 3 "$what failed (exit $rc)"; fi
}

login_help() {
  cat >&2 <<EOF
deploy-web: the owner logs in once (woowtech/README.md section 27):
  cd "\$(mktemp -d)"
  XDG_CONFIG_HOME=$WRANGLER_HOME npx --yes wrangler@$WRANGLER_VERSION login --device --scopes account:read user:read pages:write
deploy-web: and creates the project once:
  cd "\$(mktemp -d)"
  CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID XDG_CONFIG_HOME=$WRANGLER_HOME WRANGLER_CACHE_DIR=\$(mktemp -d) npx --yes wrangler@$WRANGLER_VERSION pages project create $PROJECT --production-branch main
EOF
}

rollback_help() {
  if [ "$MODE" != production ]; then return 0; fi
  cat >&2 <<EOF
deploy-web: to roll production back (woowtech/README.md section 27, rollback):
  Cloudflare dashboard > Workers & Pages > $PROJECT > Deployments > ... on the last good production
  deployment > Rollback to this deployment. wrangler has no rollback for Pages; the API is
  POST https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/deployments/<id>/rollback
  The first deployment has nothing to roll back to: deploy another commit or the maintenance page.
  Never remove the custom domain: daemons' config.json files trust $SITE_ORIGIN.
EOF
}

# --- checks before the build (exit 2) ---
if [ "$ALLOW_DIRTY" = true ]; then
  say "WOOW_ALLOW_DIRTY=1: not checking that the worktree is clean and pushed (local E2E only)"
else
  git -C "$REPO" fetch --quiet origin || die 2 "git fetch origin failed"
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    die 2 "the worktree has changes (git status): deploy a clean commit"
  fi
  # Without -q: grep reads everything, so git never gets SIGPIPE under pipefail.
  if ! git -C "$REPO" branch -r --contains HEAD | grep '^[[:space:]]*origin/' >/dev/null; then
    die 2 "HEAD ($SHORT) is on no origin branch: push it first"
  fi
fi
for env_file in "$REPO"/packages/app/.env*; do
  if [ -e "$env_file" ]; then
    die 2 "$env_file exists: Expo would build its variables into the web app (move it away)"
  fi
done

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}
LOCK_SHA=$(sha256_of "$REPO/package-lock.json") || die 2 "cannot read $REPO/package-lock.json"
case "$LOCK_SHA" in
  '' | *[!0-9a-f]*) die 2 "no SHA-256 for $REPO/package-lock.json (got \"$LOCK_SHA\")" ;;
esac

# --- wrangler and the login (exit 4), before the build: an upload with an expired login fails
# at once instead of after a build of about 20 minutes. A dry run never runs wrangler. ---
check_login() {
  if [ -d "$HOME/.wrangler" ]; then
    die 4 "$HOME/.wrangler exists: wrangler reads its login there instead of $WRANGLER_HOME (move it away)"
  fi
  WRANGLER_SEEN=$(wr --version 2>/dev/null | tail -n 1 | tr -d '[:space:]') || true
  if [ "$WRANGLER_SEEN" != "$WRANGLER_VERSION" ]; then
    die 4 "wrangler is \"$WRANGLER_SEEN\", not $WRANGLER_VERSION"
  fi
  WHOAMI=$(wr whoami --json 2>/dev/null) || true
  if ! node -e 'const [raw, account, allowed, home] = process.argv.slice(1);
  const fail = (message) => { console.error("deploy-web: " + message); process.exit(1); };
  let who;
  try { who = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { fail("wrangler whoami --json printed no JSON"); }
  if (who.loggedIn !== true) fail("wrangler is not logged in to Cloudflare in " + home);
  if (who.authType !== "OAuth Token") fail("wrangler uses " + who.authType + ", not the owner OAuth login");
  const scopes = Array.isArray(who.tokenPermissions) ? who.tokenPermissions : [];
  const extra = scopes.filter((scope) => !allowed.split(" ").includes(scope));
  if (extra.length > 0) fail("the login has scopes beyond " + allowed + ": " + extra.join(" ") + ". Log out and log in again with the scopes below.");
  if (!scopes.includes("pages:write")) fail("the login has no pages:write scope");
  const accounts = Array.isArray(who.accounts) ? who.accounts : [];
  if (!accounts.some((entry) => entry && entry.id === account)) fail("the login cannot use the WOOWTECH account " + account);' \
    "$WHOAMI" "$ACCOUNT_ID" "$ALLOWED_SCOPES" "$WRANGLER_HOME"; then
    login_help
    exit 4
  fi
  PROJECTS=$(wr pages project list --json 2>/dev/null) || {
    login_help
    die 4 "wrangler pages project list failed"
  }
  # The project's domains, such as "woowtech-smart-web.pages.dev, smart.woowtech.io".
  if ! DOMAINS=$(node -e 'const [raw, name] = process.argv.slice(1);
  const projects = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
  const project = projects.find((entry) => entry["Project Name"] === name);
  if (!project) process.exit(1);
  process.stdout.write(String(project["Project Domains"] ?? ""));' "$PROJECTS" "$PROJECT" 2>/dev/null); then
    login_help
    die 4 "the account has no Pages project $PROJECT"
  fi
}
DOMAINS=""
if [ "$MODE" != dry-run ]; then check_login; fi

# --- npm ci (optional) and the build (exit 3) ---
STAMP=$REPO/node_modules/.woow-npm-ci
NPM_CI_RAN=false
if [ "$FRESH_INSTALL" = true ]; then
  GIT_DIR_REAL=$(cd "$(git -C "$REPO" rev-parse --absolute-git-dir)" && pwd -P)
  COMMON_DIR=$(git -C "$REPO" rev-parse --git-common-dir)
  case "$COMMON_DIR" in
    /*) ;;
    *) COMMON_DIR=$REPO/$COMMON_DIR ;;
  esac
  if [ "$GIT_DIR_REAL" = "$(cd "$COMMON_DIR" && pwd -P)" ]; then
    die 2 "WOOW_FRESH_INSTALL=1 runs npm ci, which replaces node_modules: use a linked worktree (git worktree add --detach ~/projects/woowtech-smart-web-deploy $SHORT), not $REPO"
  fi
  if [ "$(cat "$STAMP" 2>/dev/null || true)" = "$LOCK_SHA" ]; then
    say "node_modules is already npm ci's install of this package-lock.json"
  else
    say "npm ci in $REPO (heavy.sh, label $HEAVY_LABEL; about 21 minutes on this Mac)"
    run_heavy "npm ci" npm --prefix "$REPO" ci
    printf '%s\n' "$LOCK_SHA" >"$STAMP"
    NPM_CI_RAN=true
  fi
fi

# Outside the repository, so packages/app/dist (the daemon's web UI and Electron) stays as it is.
OUT=$OUT_ROOT/$SHORT
# Next to the export, not in it: everything in the export is uploaded.
BUILD_INFO=$OUT.build.json
# build_record <freshInstall> <dirty>: what BUILD_INFO says about a build of this commit.
build_record() {
  printf '{\n  "sha": "%s",\n  "lockfileSha256": "%s",\n  "freshInstall": %s,\n  "dirty": %s\n}\n' \
    "$SHA" "$LOCK_SHA" "$1" "$2"
}
DIRTY=false
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then DIRTY=true; fi
# An upload reuses an export built from this commit and lockfile in a clean worktree, and with
# WOOW_FRESH_INSTALL=1 only one built on npm ci's install. A dry run always builds.
REUSE=false
if [ "$MODE" != dry-run ] && [ "$NPM_CI_RAN" = false ] && [ -d "$OUT" ] && [ -f "$BUILD_INFO" ]; then
  RECORD=$(cat "$BUILD_INFO")
  if [ "$RECORD" = "$(build_record true false)" ]; then
    REUSE=true
  elif [ "$FRESH_INSTALL" = false ] && [ "$RECORD" = "$(build_record false false)" ]; then
    REUSE=true
  fi
fi
if [ "$REUSE" = true ]; then
  say "using the export already built from this commit and lockfile: $OUT"
else
  mkdir -p "$OUT_ROOT"
  rm -rf "$OUT" "$BUILD_INFO"
  say "building the web export into $OUT (heavy.sh, label $HEAVY_LABEL)"
  # --clear: Metro's transform cache can keep an older embedded app manifest.
  # --max-workers 2: this Mac has 8 GB.
  run_heavy "the web export" env -u EXPO_PUBLIC_LOCAL_DAEMON -u EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL \
    -u PASEO_WEB_PLATFORM -u PASEO_FDROID_BUILD -u PASEO_PROFILE_BUILD \
    APP_VARIANT=production WOOWTECH_AI_CONTENT_REPORT_URL="$REPORT_URL" \
    NODE_OPTIONS=--max-old-space-size=4096 REPO="$REPO" OUT="$OUT" \
    sh -c 'npm --prefix "$REPO" run build:app-deps && cd "$REPO/packages/app" && npx expo export --platform web --output-dir "$OUT" --clear --max-workers 2'
  if [ ! -f "$OUT/index.html" ]; then die 3 "the web export wrote no $OUT/index.html"; fi
  build_record "$FRESH_INSTALL" "$DIRTY" >"$BUILD_INFO"
fi

cp "$REPO/woowtech/web/_headers" "$OUT/_headers"
node "$REPO/woowtech/web/check-export.mjs" "$OUT" || die 3 "check-export.mjs found problems in $OUT (above)"
if [ "$MODE" = dry-run ]; then
  say "dry run done, nothing uploaded: $OUT passed its checks"
  exit 0
fi

# --- confirmation (exit 2) ---
if [ -n "${WOOW_CONFIRM_SHA:-}" ]; then
  case "$WOOW_CONFIRM_SHA" in
    ???????*) ;;
    *) die 2 "WOOW_CONFIRM_SHA must be at least 7 characters of the commit" ;;
  esac
  case "$SHA" in
    "$WOOW_CONFIRM_SHA"*) say "WOOW_CONFIRM_SHA confirms $SHA7" ;;
    *) die 2 "WOOW_CONFIRM_SHA=$WOOW_CONFIRM_SHA is not this commit ($SHA): nothing was uploaded" ;;
  esac
fi
confirm_from() {
  local answer=""
  if [ ! -r "$1" ]; then die 2 "cannot read the confirmation from $1: nothing was uploaded"; fi
  printf 'deploy-web: type the first 7 characters of %s to upload it to production: ' "$SHA" >&2
  IFS= read -r answer <"$1" || true
  answer=$(printf '%s' "$answer" | tr -d '[:space:]')
  if [ "$answer" != "$SHA7" ]; then die 2 "\"$answer\" is not $SHA7: nothing was uploaded"; fi
}
if [ "$MODE" = production ]; then
  say "production upload of $(git -C "$REPO" log -1 --format='%H %an %ad %s')"
  LIVE=$(wr pages deployment list --project-name "$PROJECT" --environment production --json 2>/dev/null) ||
    die 4 "wrangler pages deployment list failed"
  PREVIOUS=$(node -e 'const raw = process.argv[1];
const list = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
process.stdout.write(list.length > 0 ? String(list[0].Source ?? "") : "");' "$LIVE" 2>/dev/null) || PREVIOUS=unknown
  if [ -z "$PREVIOUS" ]; then
    say "production has no deployment yet"
  elif [ "$PREVIOUS" = unknown ]; then
    say "could not read production's deployments from wrangler"
  elif git -C "$REPO" rev-parse --verify --quiet "$PREVIOUS^{commit}" >/dev/null; then
    say "production runs $PREVIOUS now; changes since then:"
    git -C "$REPO" diff --stat "$PREVIOUS..HEAD"
  else
    say "production runs $PREVIOUS now, a commit this repository does not have (git fetch to compare)"
  fi
  if [ -z "${WOOW_CONFIRM_SHA:-}" ]; then
    if [ -n "${WOOW_TTY:-}" ]; then
      confirm_from "$WOOW_TTY"
    elif [ -t 0 ]; then
      confirm_from /dev/tty
    else
      say "no terminal and no WOOW_CONFIRM_SHA: uploading without a confirmation (owner decision O12)"
    fi
  fi
fi

# --- upload (exit 5) ---
BRANCH=main
ENVIRONMENT=production
if [ "$MODE" = preview ]; then
  BRANCH=preview
  ENVIRONMENT=preview
fi
say "uploading $OUT to the Pages project $PROJECT, branch $BRANCH"
wr pages deploy "$OUT" --project-name "$PROJECT" --branch "$BRANCH" \
  --commit-hash "$SHA" --commit-message "$MSG" --commit-dirty=false ||
  die 5 "wrangler pages deploy failed"

# --- after the upload (exit 6) ---
LIST=$(wr pages deployment list --project-name "$PROJECT" --environment "$ENVIRONMENT" --json 2>/dev/null) || {
  rollback_help
  die 6 "wrangler pages deployment list failed after the upload"
}
if ! DEPLOYED_URL=$(node -e 'const [raw, sha7, environment, branch] = process.argv.slice(1);
const list = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1));
const latest = list[0] ?? {};
const want = environment[0].toUpperCase() + environment.slice(1);
if (latest.Source !== sha7 || latest.Environment !== want || latest.Branch !== branch) {
  console.error("deploy-web: the latest " + environment + " deployment is " + JSON.stringify(latest));
  process.exit(1);
}
process.stdout.write(String(latest.Deployment ?? ""));' "$LIST" "$SHA7" "$ENVIRONMENT" "$BRANCH"); then
  rollback_help
  die 6 "the latest $ENVIRONMENT deployment is not $SHA7 on $BRANCH"
fi
VERIFY_FLAG=""
if [ "$MODE" = production ]; then
  VERIFY_BASE=$PAGES_DEV_ORIGIN
  case ", $DOMAINS," in
    *", ${SITE_ORIGIN#https://},"*) VERIFY_BASE=$SITE_ORIGIN ;;
  esac
else
  VERIFY_BASE=$DEPLOYED_URL
  VERIFY_FLAG=--allow-access
fi
attempt=1
until node "$REPO/woowtech/web/verify-live.mjs" "$VERIFY_BASE" "$OUT" ${VERIFY_FLAG:+"$VERIFY_FLAG"}; do
  if [ "$attempt" -ge "$VERIFY_ATTEMPTS" ]; then
    rollback_help
    die 6 "$VERIFY_BASE does not serve this export (verify-live.mjs above)"
  fi
  attempt=$((attempt + 1))
  say "checking $VERIFY_BASE again in ${VERIFY_WAIT}s (attempt $attempt of $VERIFY_ATTEMPTS)"
  sleep "$VERIFY_WAIT"
done
say "done: $SHA7 is the $ENVIRONMENT deployment of $PROJECT and $VERIFY_BASE serves it; the wrangler login stays (O12)"
