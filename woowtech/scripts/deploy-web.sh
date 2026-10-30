#!/bin/bash
# deploy-web.sh: build a brand's web app and upload it to Cloudflare Pages.
#
# The web app is packages/app's `expo export --platform web`. Each brand has its own Pages
# project, Cloudflare account and site (the brand presets below): woowtech smart's is the project
# woowtech-smart-web (WOOWTECH's Cloudflare account) at https://smart.woowtech.io, Apporo smart's
# the project apporo-smart-web (the account that holds apporo.ai) at https://smart.apporo.ai.
# woowtech/README.md section 27 has the whole procedure, the owner's steps and the rollback.
#
#   WOOW_DRY_RUN=1 woowtech/scripts/deploy-web.sh   # build and check; wrangler never runs
#   woowtech/scripts/deploy-web.sh --preview        # upload to the preview branch
#   woowtech/scripts/deploy-web.sh                  # upload to production (branch main)
#   npm run deploy:web --workspace=@getpaseo/app    # the same as the line above
#   woowtech/scripts/deploy-web.sh --brand=apporo   # Apporo smart's web app (with any of the above)
#   woowtech/scripts/deploy-web.sh --logout [pages|reports]   # end a wrangler login
#
# --brand=<id> picks the brand: woowtech (the default) or apporo. The checkout always has
# woowtech applied (woowtech/brands). Another brand is built in a copy of HEAD's files, made next
# to the exports, with this checkout's node_modules cloned into it (copy-on-write on APFS) and the
# brand applied by woowtech/tools/apply-brand.mjs; the copy is deleted after the build (or when
# the script stops before that).
#
# Uploads use the owner's wrangler login in a directory of its own,
# ~/.local/share/woowtech-smart/wrangler-pages, made once with only the account:read, user:read
# and pages:write scopes. Every run checks those scopes with `wrangler whoami --json`, and no run
# logs out (owner decision O12, 2026-10-27). The trade-off the owner accepted: while that login
# is valid, any agent on this Mac can deploy to production. The same login can also delete
# deployments (the rollback targets), detach the custom domain and delete the project. Both
# brands use it: it can use both accounts, and each run talks to its brand's account only.
#
# Never run wrangler with your home directory as its working directory: it then makes ~/.wrangler,
# wrangler stops reading XDG_CONFIG_HOME from that moment on, and "not logged in" (or a logout of
# the wrong login) follows. Every wrangler call here runs in a new empty directory with stdin
# closed (an expired login fails; it never opens a browser login with wrangler's broad default
# scopes), and the script refuses to go on while ~/.wrangler exists.
#
# Before anything is uploaded:
#   - The commit is clean (git status, and no assume-unchanged or skip-worktree files), HEAD is on
#     an origin branch (git fetch --prune), there is no packages/app/.env* and no
#     EXPO_PUBLIC_LOCAL_DAEMON (every visitor's browser would probe that address forever). This is
#     checked before the build, after it and right before the upload.
#   - The export is built in a new directory and moved to its place only when the build worked.
#     What is uploaded is a copy of it, matched against a SHA-256 manifest and checked by
#     woowtech/web/check-export.mjs for the brand, with the brand's baseline
#     (woowtech/web/export-baseline.json for woowtech smart, export-baseline.<brand>.json next to
#     it for another brand).
#   - wrangler is exactly WRANGLER_VERSION, and the login (checked again right before the upload)
#     has only the allowed scopes and can use the brand's account, the only one any call runs for
#     (CLOUDFLARE_ACCOUNT_ID).
#   - Production only: the commit production runs now is an ancestor of HEAD. For a downgrade, or
#     when that commit is not in this repository, set WOOW_ALLOW_DOWNGRADE=1 and answer the prompt
#     at a terminal.
#   - Production only: when the files that guard the deploy (the brand's export baseline, _headers,
#     check-export.mjs, verify-live.mjs, this script) differ from production's commit, or
#     production has no deployment yet, the script prints that diff with a 12-character hash and
#     stops (exit 7) until WOOW_ACK_GUARD_DIFF=<hash> is set or the hash is typed at a terminal.
#     An agent shows the diff to the owner in chat and waits for a yes before the second run.
#     This stops an accident, not a deliberate agent: any agent on this Mac can compute the hash,
#     and the baseline only catches accidental additions.
#
# Settings (environment variables):
#   WOOW_CONFIRM_SHA=<7 or more characters of HEAD>  confirms the commit without a prompt. With
#       neither this nor a terminal (an agent), a production upload goes ahead unconfirmed; from
#       a terminal it asks for the first 7 characters and waits 10 minutes. An agent that runs
#       this script in a terminal (Omnigent terminal, tmux) must set WOOW_CONFIRM_SHA, or it
#       waits at the prompt.
#   WOOW_ACK_GUARD_DIFF=<12 characters>  acknowledges the guard diff with that hash (exit 7).
#   WOOW_ALLOW_DOWNGRADE=1  allows production to go back or sideways; it still asks at a terminal.
#   WOOW_FRESH_INSTALL=1   runs `npm ci` first, unless node_modules is already npm ci's install of
#       this package-lock.json (node_modules/.woow-npm-ci). Only in a linked worktree, such as
#       ~/projects/woowtech-smart-web-deploy: npm ci replaces node_modules.
#   WOOW_ALLOW_DIRTY=1     with WOOW_DRY_RUN=1 only (the local E2E): skips the clean and pushed
#       checks. woowtech smart only: another brand is built from HEAD's files, so commit first.
#   WOOW_HEAVY_LABEL       heavy.sh label for npm ci and the build (default web-export).
#   WOOW_NODE22_BIN        Node 22 to put first on PATH when node is not 22 ("" for none).
#   WOOW_VERIFY_ATTEMPTS, WOOW_VERIFY_WAIT  how often and how many seconds apart verify-live.mjs
#       checks the site after an upload (3, 20).
#   WOOW_HEAVY, WOOW_WRANGLER, WOOW_TTY  stand-ins for woowtech/web-deploy.test.mjs.
#
# After the custom domain is attached the owner makes an empty file in the login directory:
# domain-attached for woowtech smart, domain-attached-<brand> for another brand. From then on a
# project without the brand's site is an error (exit 4): someone detached the domain (README
# section 27, incident). Before it, only the deployment's own address is checked.
#
# --logout [pages|reports]  runs `wrangler logout` for that login directory (pages by default)
#   in the clean environment above, and succeeds only when `wrangler whoami --json` then says
#   loggedIn false. The grant can also be revoked in the Cloudflare dashboard.
#
# Exit codes: 0 done; 2 a check before the build, the provenance of the commit, or the
# confirmation; 3 npm ci, the brand's copy, the build or check-export; 4 wrangler (version, login,
# scopes, account, project, the custom domain, a logout that did not work); 5 the upload; 6 the
# check after the upload (it prints how to roll back); 7 the guard diff was not acknowledged; 8
# uploaded and checked at the deployment's own address, but the brand's site is on the project
# and does not answer (not Active yet; no rollback needed); 75 heavy.sh gave up waiting for its
# lock.
set -euo pipefail

# 2026-10-08. It has `login --device`, `login --scopes` and `whoami --json` (README section 27).
WRANGLER_VERSION=4.149.0
DATA_ROOT=$HOME/.local/share/woowtech-smart
WRANGLER_HOME=$DATA_ROOT/wrangler-pages
REPORTS_HOME=$DATA_ROOT/wrangler-reports
ALLOWED_SCOPES="account:read user:read pages:write offline_access"
OUT_ROOT=$DATA_ROOT/web-dist
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904
HEAVY=${WOOW_HEAVY:-$DATA_ROOT/coord/bin/heavy.sh}
HEAVY_LABEL=${WOOW_HEAVY_LABEL:-web-export}
NODE22_BIN=${WOOW_NODE22_BIN-/opt/homebrew/opt/node@22/bin}
VERIFY_ATTEMPTS=${WOOW_VERIFY_ATTEMPTS:-3}
VERIFY_WAIT=${WOOW_VERIFY_WAIT:-20}
GUARD_DIFF_LINES=200

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

# is_hex <value> <length>: <length> characters of 0-9a-f.
is_hex() {
  case "$1" in
    *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -eq "$2" ]
}

PREVIEW=false
LOGOUT=""
BRAND=""
while [ $# -gt 0 ]; do
  case "$1" in
    --preview) PREVIEW=true ;;
    --brand=*)
      BRAND=${1#--brand=}
      if [ -z "$BRAND" ]; then die 2 "--brand= needs a brand: woowtech or apporo"; fi
      ;;
    --logout)
      LOGOUT=pages
      case "${2:-}" in
        pages | reports)
          LOGOUT=$2
          shift
          ;;
      esac
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die 2 "unknown argument $1 (see --help)" ;;
  esac
  shift
done
MODE=production
if [ "$PREVIEW" = true ]; then MODE=preview; fi
if flag WOOW_DRY_RUN; then MODE=dry-run; fi
if [ -n "$LOGOUT" ]; then
  if [ "$MODE" != production ] || [ -n "$BRAND" ]; then
    die 2 "--logout stands alone: not with --preview, --brand or WOOW_DRY_RUN=1"
  fi
  MODE=logout
fi
BRAND=${BRAND:-woowtech}
# Each brand's Pages project, Cloudflare account, site, report receiver (built into the app),
# export baseline and domain marker. woowtech/web-deploy.test.mjs keeps the site and the report
# receiver equal to the brand's file (woowtech/brands/<id>.json: web.host and
# services.aiContentReportUrl), and the baseline and the marker apart from the other brands'.
case "$BRAND" in
  woowtech)
    PROJECT=woowtech-smart-web
    ACCOUNT_ID=9c27f623ee596e0b67be56263bcb1974
    ACCOUNT_NAME="WOOWTECH's account"
    SITE_ORIGIN=https://smart.woowtech.io
    REPORT_URL=https://reports.woowtech.io/v1/ai-content-reports
    BASELINE=woowtech/web/export-baseline.json
    MARKER_NAME=domain-attached
    ;;
  apporo)
    # Alan's account, which holds the apporo.ai zone (owner decision, 2026-10-30).
    PROJECT=apporo-smart-web
    ACCOUNT_ID=9f14a17191df1e77889566d848f063ad
    ACCOUNT_NAME="the account that holds apporo.ai"
    SITE_ORIGIN=https://smart.apporo.ai
    REPORT_URL=https://www.apporo.ai/api/smart/v1/ai-content-reports
    BASELINE=woowtech/web/export-baseline.apporo.json
    MARKER_NAME=domain-attached-apporo
    ;;
  *) die 2 "unknown brand \"$BRAND\": woowtech or apporo (see --help)" ;;
esac
DOMAIN_MARKER=$WRANGLER_HOME/$MARKER_NAME
GUARD_FILES="$BASELINE woowtech/web/_headers woowtech/web/check-export.mjs woowtech/web/verify-live.mjs woowtech/scripts/deploy-web.sh"
if [ -n "${WOOW_TTY:-}" ] && [ -z "${WOOW_WRANGLER:-}" ]; then
  die 2 "WOOW_TTY only works with a stand-in wrangler (WOOW_WRANGLER), in tests"
fi
ALLOW_DIRTY=false
if flag WOOW_ALLOW_DIRTY; then
  if [ "$MODE" != dry-run ]; then die 2 "WOOW_ALLOW_DIRTY=1 is only for WOOW_DRY_RUN=1 (the local E2E)"; fi
  if [ "$BRAND" != woowtech ]; then
    die 2 "WOOW_ALLOW_DIRTY=1 builds this checkout as it is, but brand $BRAND is built from HEAD's files: commit first"
  fi
  ALLOW_DIRTY=true
fi
FRESH_INSTALL=false
if flag WOOW_FRESH_INSTALL; then FRESH_INSTALL=true; fi
ALLOW_DOWNGRADE=false
if flag WOOW_ALLOW_DOWNGRADE; then ALLOW_DOWNGRADE=true; fi
ACK_GUARD_DIFF=${WOOW_ACK_GUARD_DIFF:-}
if [ -n "$ACK_GUARD_DIFF" ] && ! is_hex "$ACK_GUARD_DIFF" 12; then
  die 2 "WOOW_ACK_GUARD_DIFF must be the 12 hexadecimal characters this script printed, not \"$ACK_GUARD_DIFF\""
fi

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

# Only the owner's login in WRANGLER_HOME: no API token or key from the caller's environment, and
# nothing that moves wrangler's API, token or revoke requests (CF_API_BASE_URL is the old name of
# CLOUDFLARE_API_BASE_URL; WRANGLER_TOKEN_URL and WRANGLER_REVOKE_URL receive the refresh token).
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL CF_API_TOKEN CF_API_KEY CF_EMAIL CF_ACCOUNT_ID
unset WRANGLER_CF_AUTHORIZATION_TOKEN CLOUDFLARE_API_BASE_URL CF_API_BASE_URL CLOUDFLARE_COMPLIANCE_REGION
unset WRANGLER_API_ENVIRONMENT WRANGLER_AUTH_DOMAIN WRANGLER_AUTH_URL WRANGLER_TOKEN_URL WRANGLER_REVOKE_URL WRANGLER_CLIENT_ID
# Set by `npm run`; npx would look for wrangler in the repository instead of WRANGLER_VERSION.
unset npm_config_local_prefix
# With a terminal on stdout git would start a pager for `git diff` and wait for a key (the pager
# also empties the terminal's pending input).
export GIT_PAGER=cat
export CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID WRANGLER_SEND_METRICS=false EXPO_NO_TELEMETRY=1
TMP=$(mktemp -d "${TMPDIR:-/tmp}/woowtech-deploy-web.XXXXXX")
case "$TMP" in
  /*) ;;
  *) die 2 "TMPDIR must be an absolute path, not $TMP" ;;
esac
# An empty cache: `pages project list` and `pages deployment list` read the account id from
# wrangler's cache before the environment, and the cache is otherwise found in node_modules/.cache.
WRANGLER_CACHE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/woowtech-wrangler-cache.XXXXXX")
export WRANGLER_CACHE_DIR
STAGE=""
BRAND_TREE=""
cleanup() {
  rm -rf "$TMP" "$WRANGLER_CACHE_DIR"
  if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
  if [ -n "$BRAND_TREE" ]; then rm -rf "$BRAND_TREE"; fi
}
trap cleanup EXIT

# wr_in <directory> <wrangler arguments...>: wrangler in that (empty) directory: wrangler picks
# its profile by the working directory, and npx must not find the repository's own wrangler.
# Standard input is /dev/null so that wrangler never counts as interactive: with a terminal on
# both stdin and stdout, an expired login would start wrangler's own login with its broad default
# scopes and store that token in WRANGLER_HOME.
wr_in() {
  local dir=$1
  shift
  if [ -n "${WOOW_WRANGLER:-}" ]; then
    (cd "$dir" && env -u NODE_OPTIONS XDG_CONFIG_HOME="$WRANGLER_HOME" "$WOOW_WRANGLER" "$@" </dev/null)
  else
    (cd "$dir" && env -u NODE_OPTIONS XDG_CONFIG_HOME="$WRANGLER_HOME" npx --yes "wrangler@$WRANGLER_VERSION" "$@" </dev/null)
  fi
}
wr() {
  local dir
  dir=$(mktemp -d "$TMP/wrangler.XXXXXX") || return 1
  wr_in "$dir" "$@"
}

# run_heavy <what> <command...>: one heavy job through heavy.sh.
run_heavy() {
  local what=$1 rc=0
  shift
  "$HEAVY" run "$HEAVY_LABEL" -- "$@" || rc=$?
  if [ "$rc" -eq 75 ]; then die 75 "heavy.sh gave up waiting for its lock ($what)"; fi
  if [ "$rc" -ne 0 ]; then die 3 "$what failed (exit $rc)"; fi
}

check_no_legacy_wrangler_dir() {
  if [ -d "$HOME/.wrangler" ]; then
    die 4 "$HOME/.wrangler exists: wrangler reads its login there instead of $WRANGLER_HOME (move it away; never run wrangler with your home directory as its working directory)"
  fi
}

# --- --logout: end a wrangler login (exit 4 when it did not work) ---
if [ "$MODE" = logout ]; then
  if [ "$LOGOUT" = reports ]; then WRANGLER_HOME=$REPORTS_HOME; fi
  check_no_legacy_wrangler_dir
  say "wrangler logout for $WRANGLER_HOME"
  wr logout || die 4 "wrangler logout failed"
  WHOAMI=$(wr whoami --json 2>/dev/null) || true
  if ! node -e 'const raw = process.argv[1];
let who;
try { who = JSON.parse(raw.slice(raw.search(/^\{/m), raw.lastIndexOf("}") + 1)); } catch { process.exit(1); }
process.exit(who && who.loggedIn === false ? 0 : 1);' "$WHOAMI"; then
    die 4 "wrangler still reports a login in $WRANGLER_HOME (or says nothing) after the logout: revoke its grant in the Cloudflare dashboard too"
  fi
  say "$WRANGLER_HOME has no login now (whoami --json: loggedIn false). Revoke wrangler's grant in the Cloudflare dashboard as well."
  exit 0
fi

# --- the commit and the settings that decide what the upload says about it (exit 2) ---
case "$MSG" in
  -*) die 2 "the commit subject starts with \"-\" (\"$MSG\"): reword the commit; wrangler could read the subject as an option" ;;
esac
CONFIRMED_BY_ENV=false
if [ "$MODE" = production ] || [ "$MODE" = preview ]; then
  if [ -n "${WOOW_CONFIRM_SHA:-}" ]; then
    case "$WOOW_CONFIRM_SHA" in
      ???????*) ;;
      *) die 2 "WOOW_CONFIRM_SHA must be at least 7 characters of the commit" ;;
    esac
    case "$SHA" in
      "$WOOW_CONFIRM_SHA"*) CONFIRMED_BY_ENV=true ;;
      *) die 2 "WOOW_CONFIRM_SHA=$WOOW_CONFIRM_SHA is not this commit ($SHA): nothing was uploaded" ;;
    esac
  fi
fi
# EXPO_PUBLIC_LOCAL_DAEMON would be built into the web app: every visitor's browser would probe
# that address every second, for ever, whatever the localhost probe policy says (README section 27).
if [ -n "${EXPO_PUBLIC_LOCAL_DAEMON+set}" ]; then
  die 2 "EXPO_PUBLIC_LOCAL_DAEMON is set: the web app would make every visitor's browser probe that address for ever (unset it)"
fi

login_help() {
  cat >&2 <<EOF
deploy-web: the owner logs in once (woowtech/README.md section 27). Never run wrangler with the
deploy-web: home directory as its working directory:
  test ! -d ~/.wrangler && cd "\$(mktemp -d)" && \\
    XDG_CONFIG_HOME=$WRANGLER_HOME npx --yes wrangler@$WRANGLER_VERSION login --device --scopes account:read user:read pages:write
deploy-web: and creates the project once:
  test ! -d ~/.wrangler && cd "\$(mktemp -d)" && \\
    CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID XDG_CONFIG_HOME=$WRANGLER_HOME WRANGLER_CACHE_DIR=\$(mktemp -d) npx --yes wrangler@$WRANGLER_VERSION pages project create $PROJECT --production-branch main
EOF
}

# What production ran before this upload (set by production_gates).
PREVIOUS=""
PREVIOUS_ID=""
rollback_help() {
  if [ "$MODE" != production ]; then return 0; fi
  {
    printf 'deploy-web: to roll production back (woowtech/README.md section 27, rollback):\n'
    if [ -n "$PREVIOUS_ID" ]; then
      printf '  production ran deployment %s (commit %s) before this upload:\n' "$PREVIOUS_ID" "${PREVIOUS:-unknown}"
      printf '  https://dash.cloudflare.com/%s/pages/view/%s/%s\n' "$ACCOUNT_ID" "$PROJECT" "$PREVIOUS_ID"
      printf '  open it and choose Rollback to this deployment. wrangler has no rollback for Pages; the API is\n'
      printf '  POST https://api.cloudflare.com/client/v4/accounts/%s/pages/projects/%s/deployments/%s/rollback\n' \
        "$ACCOUNT_ID" "$PROJECT" "$PREVIOUS_ID"
    else
      printf '  production had no deployment before this one, so there is nothing to roll back to: deploy\n'
      printf '  another commit or the maintenance page.\n'
    fi
    printf '  If the upload itself failed, look at the Deployments list first: wrangler may have made the deployment before it failed.\n'
    printf '  Never remove the custom domain: daemons config.json files trust %s.\n' "$SITE_ORIGIN"
  } >&2
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}
sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d ' ' -f 1
  else
    shasum -a 256 | cut -d ' ' -f 1
  fi
}

# check_source <when>: still the commit that was checked, in a clean worktree. The build takes about
# 20 minutes and the worktree is shared: this runs before it, after it and right before the upload.
check_source() {
  local when=$1 head changes env_file
  head=$(git -C "$REPO" rev-parse HEAD) || die 2 "git rev-parse HEAD failed $when"
  if [ "$head" != "$SHA" ]; then
    die 2 "HEAD is ${head:0:12}, no longer $SHORT, $when: nothing was uploaded"
  fi
  if [ "$ALLOW_DIRTY" = false ]; then
    changes=$(git -C "$REPO" status --porcelain) || die 2 "git status failed $when"
    if [ -n "$changes" ]; then
      printf '%s\n' "$changes" | head -n 10 >&2 || true
      die 2 "the worktree has changes $when (git status, first lines above): deploy a clean commit"
    fi
    # git status does not show changes to files marked assume-unchanged (lowercase) or skip-worktree (S).
    if git -C "$REPO" ls-files -v | grep '^[a-zS] ' >/dev/null; then
      die 2 "git is told to ignore changes to some tracked files $when (assume-unchanged or skip-worktree, see git ls-files -v): undo that"
    fi
  fi
  for env_file in "$REPO"/packages/app/.env*; do
    if [ -e "$env_file" ]; then
      die 2 "$env_file exists $when: Expo would build its variables into the web app (move it away)"
    fi
  done
  if [ "$MODE" != dry-run ]; then check_no_legacy_wrangler_dir; fi
}

# --- checks before the build (exit 2) ---
if [ "$ALLOW_DIRTY" = true ]; then
  say "WOOW_ALLOW_DIRTY=1: not checking that the worktree is clean and pushed (local E2E only)"
  check_source "before the build"
else
  # --prune: a branch deleted on GitHub must not keep HEAD "on origin".
  git -C "$REPO" fetch --quiet --prune origin || die 2 "git fetch --prune origin failed"
  check_source "before the build"
  ORIGIN_BRANCHES=$(git -C "$REPO" branch -r --contains HEAD | grep '^[[:space:]]*origin/' || true)
  if [ -z "$ORIGIN_BRANCHES" ]; then
    die 2 "HEAD ($SHORT) is on no origin branch: push it first"
  fi
  ORIGIN_LIST=$(printf '%s\n' "$ORIGIN_BRANCHES" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '\n' ' ')
  say "HEAD $SHORT is on ${ORIGIN_LIST% }"
fi

LOCK_SHA=$(sha256_of "$REPO/package-lock.json") || die 2 "cannot read $REPO/package-lock.json"
case "$LOCK_SHA" in
  '' | *[!0-9a-f]*) die 2 "no SHA-256 for $REPO/package-lock.json (got \"$LOCK_SHA\")" ;;
esac

# --- wrangler and the login (exit 4), before the build: an upload with an expired login fails
# at once instead of after a build of about 20 minutes, and again right before the upload. A dry
# run never runs wrangler. ---
DOMAINS=""
check_login() {
  check_no_legacy_wrangler_dir
  WRANGLER_SEEN=$(wr --version 2>/dev/null | tail -n 1 | tr -d '[:space:]') || true
  if [ "$WRANGLER_SEEN" != "$WRANGLER_VERSION" ]; then
    die 4 "wrangler is \"$WRANGLER_SEEN\", not $WRANGLER_VERSION"
  fi
  WHOAMI=$(wr whoami --json 2>/dev/null) || true
  if ! node -e 'const [raw, account, allowed, home, name] = process.argv.slice(1);
  const fail = (message) => { console.error("deploy-web: " + message); process.exit(1); };
  let who;
  try { who = JSON.parse(raw.slice(raw.search(/^\{/m), raw.lastIndexOf("}") + 1)); } catch { fail("wrangler whoami --json printed no JSON"); }
  if (who.loggedIn !== true) fail("wrangler is not logged in to Cloudflare in " + home);
  if (who.authType !== "OAuth Token") fail("wrangler uses " + who.authType + ", not the owner OAuth login");
  const scopes = Array.isArray(who.tokenPermissions) ? who.tokenPermissions : [];
  const extra = scopes.filter((scope) => !allowed.split(" ").includes(scope));
  if (extra.length > 0) fail("the login has scopes beyond " + allowed + ": " + extra.join(" ") + ". Log out and log in again with the scopes below.");
  if (!scopes.includes("pages:write")) fail("the login has no pages:write scope");
  const accounts = Array.isArray(who.accounts) ? who.accounts : [];
  if (!accounts.some((entry) => entry && entry.id === account)) fail("the login cannot use " + name + " " + account);' \
    "$WHOAMI" "$ACCOUNT_ID" "$ALLOWED_SCOPES" "$WRANGLER_HOME" "$ACCOUNT_NAME"; then
    login_help
    exit 4
  fi
  PROJECTS=$(wr pages project list --json 2>/dev/null) || {
    login_help
    die 4 "wrangler pages project list failed"
  }
  # The project's domains, such as "woowtech-smart-web.pages.dev, smart.woowtech.io".
  if ! DOMAINS=$(node -e 'const [raw, name] = process.argv.slice(1);
  const projects = JSON.parse(raw.slice(raw.search(/^\[/m), raw.lastIndexOf("]") + 1));
  const project = projects.find((entry) => entry["Project Name"] === name);
  if (!project) process.exit(1);
  process.stdout.write(String(project["Project Domains"] ?? ""));' "$PROJECTS" "$PROJECT" 2>/dev/null); then
    login_help
    die 4 "the account has no Pages project $PROJECT"
  fi
  if ! domain_listed && [ -e "$DOMAIN_MARKER" ]; then
    die 4 "${SITE_ORIGIN#https://} is not on the Pages project $PROJECT any more, but $DOMAIN_MARKER says it was attached: someone detached it. Do not deploy; follow the incident steps in woowtech/README.md section 27"
  fi
}
# domain_listed: the brand's site (smart.woowtech.io for woowtech smart) is among the project's
# domains (it may not be Active yet).
domain_listed() {
  case ", $DOMAINS," in
    *", ${SITE_ORIGIN#https://},"*) return 0 ;;
  esac
  return 1
}
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

# manifest_json <directory>: {"relative/path": "sha256", ...} for every file under it, by path.
manifest_json() {
  node -e 'const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.argv[1];
const entries = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = dir ? dir + "/" + entry.name : entry.name;
    const full = path.join(root, relative);
    if (entry.isDirectory()) walk(relative);
    else if (entry.isFile()) entries.push([relative, crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex")]);
    else entries.push([relative, entry.isSymbolicLink() ? "symlink to " + fs.readlinkSync(full) : "not a regular file"]);
  }
};
walk("");
entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
process.stdout.write(JSON.stringify(Object.fromEntries(entries), null, 2));' "$1"
}

# Outside the repository, so packages/app/dist (the daemon's web UI and Electron) stays as it is.
# woowtech smart's exports keep the names they had before there were two brands.
if [ "$BRAND" = woowtech ]; then OUT=$OUT_ROOT/$SHORT; else OUT=$OUT_ROOT/$BRAND-$SHORT; fi
# Next to the export, not in it: everything in the export is uploaded.
BUILD_INFO=$OUT.build.json
# What is uploaded: a private copy of the export, matched against the manifest in BUILD_INFO.
UPLOAD=$TMP/upload
# build_record <freshInstall> <dirty> <manifest json>: what BUILD_INFO says about this commit's export.
build_record() {
  printf '{\n  "sha": "%s",\n  "lockfileSha256": "%s",\n  "freshInstall": %s,\n  "dirty": %s,\n  "files": %s\n}\n' \
    "$SHA" "$LOCK_SHA" "$1" "$2" "$3"
}
# copy_to_upload <export directory>
copy_to_upload() {
  mkdir "$UPLOAD" || die 3 "cannot make $UPLOAD"
  cp -R "$1/." "$UPLOAD/" || die 3 "cannot copy $1 to $UPLOAD"
}
# clone_dir <from> <to>: a copy-on-write clone where the file system makes one (APFS), else a copy.
# Symbolic links stay links: the workspace packages in node_modules point at ../../packages/*.
clone_dir() {
  rm -rf "$2"
  if [ "$(uname -s)" = Darwin ] && cp -cR "$1" "$2" 2>/dev/null; then return 0; fi
  rm -rf "$2"
  cp -R "$1" "$2"
}
# make_brand_tree: BRAND_TREE, HEAD's files with the brand applied and this checkout's node_modules,
# for a brand the checkout does not have applied. A copy of tracked files, so nothing ignored
# (.env files, build output, secrets) comes along; the build makes the packages' dist itself.
make_brand_tree() {
  local modules applied
  BRAND_TREE=$(mktemp -d "$OUT_ROOT/.tree-${OUT##*/}.XXXXXX") || die 3 "cannot make a directory for brand $BRAND's copy"
  say "copying HEAD's files to $BRAND_TREE and applying brand $BRAND there"
  git -C "$REPO" archive --format=tar "$SHA" | tar -x -f - -C "$BRAND_TREE" ||
    die 3 "cannot copy HEAD's files to $BRAND_TREE"
  # find does not look inside a node_modules it has found: these are the root's and each package's
  # (and any in an ignored directory, which the copy does not have).
  while IFS= read -r modules; do
    if [ ! -d "$BRAND_TREE/$(dirname "$modules")" ]; then continue; fi
    clone_dir "$REPO/$modules" "$BRAND_TREE/$modules" || die 3 "cannot copy $modules to $BRAND_TREE"
  done < <(cd "$REPO" && find . -path ./.git -prune -o -name node_modules -type d -prune -print | sed 's|^\./||')
  (cd "$BRAND_TREE" && node woowtech/tools/apply-brand.mjs "$BRAND") || die 3 "apply-brand.mjs $BRAND failed in $BRAND_TREE"
  applied=$(sed -n 's/^export const BRAND_ID = "\([a-z][a-z0-9-]*\)";$/\1/p' "$BRAND_TREE/packages/protocol/src/brand-values.ts")
  if [ "$applied" != "$BRAND" ]; then die 3 "$BRAND_TREE has brand \"$applied\" applied, not $BRAND"; fi
}
DIRTY=false
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then DIRTY=true; fi
# An upload reuses an export built from this commit and lockfile in a clean worktree, and with
# WOOW_FRESH_INSTALL=1 only one built on npm ci's install. Reusing means: the copy of OUT that is
# uploaded has the manifest BUILD_INFO recorded. A dry run always builds.
REUSE=false
if [ "$MODE" != dry-run ] && [ "$NPM_CI_RAN" = false ] && [ -d "$OUT" ] && [ -f "$BUILD_INFO" ]; then
  copy_to_upload "$OUT"
  UPLOAD_FILES=$(manifest_json "$UPLOAD")
  RECORD=$(cat "$BUILD_INFO")
  if [ "$RECORD" = "$(build_record true false "$UPLOAD_FILES")" ]; then
    REUSE=true
  elif [ "$FRESH_INSTALL" = false ] && [ "$RECORD" = "$(build_record false false "$UPLOAD_FILES")" ]; then
    REUSE=true
  else
    say "$OUT is not what $BUILD_INFO recorded (or was built from another install): building again"
    rm -rf "$UPLOAD"
  fi
fi
if [ "$REUSE" = true ]; then
  say "using the export already built from this commit and lockfile: $OUT"
  check_source "before the export is reused"
else
  mkdir -p "$OUT_ROOT"
  # Stages and brand copies left by a run that was killed.
  find "$OUT_ROOT" -maxdepth 1 \( -name '.stage-*' -o -name '.tree-*' \) -mmin +1440 -exec rm -rf {} + 2>/dev/null || true
  STAGE=$(mktemp -d "$OUT_ROOT/.stage-${OUT##*/}.XXXXXX")
  BUILD_ROOT=$REPO
  if [ "$BRAND" != woowtech ]; then
    make_brand_tree
    BUILD_ROOT=$BRAND_TREE
  fi
  say "building brand $BRAND's web export into $STAGE/export (heavy.sh, label $HEAVY_LABEL)"
  # --clear: Metro's transform cache can keep an older embedded app manifest.
  # --max-workers 2: this Mac has 8 GB.
  run_heavy "the web export" env -u EXPO_PUBLIC_LOCAL_DAEMON -u EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL \
    -u PASEO_WEB_PLATFORM -u PASEO_FDROID_BUILD -u PASEO_PROFILE_BUILD \
    APP_VARIANT=production WOOWTECH_AI_CONTENT_REPORT_URL="$REPORT_URL" \
    NODE_OPTIONS=--max-old-space-size=4096 REPO="$BUILD_ROOT" OUT="$STAGE/export" \
    sh -c 'npm --prefix "$REPO" run build:app-deps && cd "$REPO/packages/app" && npx expo export --platform web --output-dir "$OUT" --clear --max-workers 2'
  if [ ! -f "$STAGE/export/index.html" ]; then die 3 "the web export wrote no $STAGE/export/index.html"; fi
  cp "$REPO/woowtech/web/_headers" "$STAGE/export/_headers"
  if [ -n "$BRAND_TREE" ]; then
    rm -rf "$BRAND_TREE"
    BRAND_TREE=""
  fi
  check_source "after the build"
  BUILT_FILES=$(manifest_json "$STAGE/export")
  # The upload is a copy of what was just built; OUT is a cache for the next run (and what the
  # local E2E and --write-baseline look at), put in place even if check-export then fails.
  copy_to_upload "$STAGE/export"
  UPLOAD_FILES=$(manifest_json "$UPLOAD")
  if [ "$UPLOAD_FILES" != "$BUILT_FILES" ]; then die 3 "the export changed while it was copied for the upload"; fi
  rm -rf "$OUT" "$BUILD_INFO"
  mv "$STAGE/export" "$OUT"
  build_record "$FRESH_INSTALL" "$DIRTY" "$BUILT_FILES" >"$BUILD_INFO"
  rm -rf "$STAGE"
  STAGE=""
fi

node "$REPO/woowtech/web/check-export.mjs" "$UPLOAD" --brand "$BRAND" --baseline "$REPO/$BASELINE" ||
  die 3 "check-export.mjs found problems in the export (above; it checked a copy of $OUT)"
if [ "$MODE" = dry-run ]; then
  say "dry run done, nothing uploaded: brand $BRAND's export $OUT passed its checks"
  exit 0
fi

# --- production: what production runs now, where this commit comes from, what guards it (exit 2, 7) ---
terminal_file() {
  if [ -n "${WOOW_TTY:-}" ]; then
    printf '%s' "$WOOW_TTY"
  elif [ -t 0 ]; then
    printf '/dev/tty'
  fi
}
# confirm_from <file> <exit code> <expected answer> <question>: the answer is read from <file> (the
# terminal, or the test's stand-in), one line, and has to be <expected answer>.
confirm_from() {
  local file=$1 code=$2 expected=$3 question=$4 answer="" rc=0
  if [ ! -r "$file" ]; then die "$code" "cannot read the answer from $file: nothing was uploaded"; fi
  printf 'deploy-web: %s: ' "$question" >&2
  IFS= read -r -t 600 answer <"$file" || rc=$?
  answer=$(printf '%s' "$answer" | tr -d '[:space:]')
  if [ "$answer" != "$expected" ]; then
    if [ -z "$answer" ] && [ "$rc" -ne 0 ]; then die "$code" "no answer within 10 minutes: nothing was uploaded"; fi
    die "$code" "\"$answer\" is not $expected: nothing was uploaded"
  fi
}
guard_diff() {
  git -C "$REPO" -c core.quotepath=false diff --no-color --no-ext-diff --no-textconv --no-renames --full-index "$1" HEAD -- $GUARD_FILES
}
# read_live: PREVIOUS_ID and PREVIOUS, the newest production deployment and its commit (7 characters).
read_live() {
  local live info
  live=$(wr pages deployment list --project-name="$PROJECT" --environment=production --json) ||
    die 4 "wrangler pages deployment list failed (wrangler's reason above; an expired login shows here too)"
  info=$(node -e 'const raw = process.argv[1];
const list = JSON.parse(raw.slice(raw.search(/^\[/m), raw.lastIndexOf("]") + 1));
const latest = list[0];
if (latest) process.stdout.write(String(latest.Id ?? "") + " " + String(latest.Source ?? ""));' "$live" 2>/dev/null) || info=unknown
  case "$info" in
    '')
      PREVIOUS=""
      PREVIOUS_ID=""
      ;;
    unknown)
      PREVIOUS=unknown
      PREVIOUS_ID=""
      ;;
    *)
      PREVIOUS_ID=${info%% *}
      PREVIOUS=${info#* }
      if [ -z "$PREVIOUS" ]; then PREVIOUS=unknown; fi
      ;;
  esac
  case "$PREVIOUS_ID" in
    *[!0-9a-zA-Z-]*) PREVIOUS_ID="" ;;
  esac
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != unknown ]; then
    if ! is_hex "$PREVIOUS" "${#PREVIOUS}" || [ "${#PREVIOUS}" -lt 7 ] || [ "${#PREVIOUS}" -gt 40 ]; then PREVIOUS=unknown; fi
  fi
}
production_gates() {
  local previous_full="" reason="" from hash total term
  read_live
  if [ -z "$PREVIOUS" ]; then
    say "production has no deployment yet"
  elif [ "$PREVIOUS" = unknown ]; then
    reason="could not read which commit production runs from wrangler"
  elif previous_full=$(git -C "$REPO" rev-parse --verify --quiet "$PREVIOUS^{commit}"); then
    if git -C "$REPO" merge-base --is-ancestor "$previous_full" HEAD; then
      say "production runs $PREVIOUS now (deployment ${PREVIOUS_ID:-unknown}); changes since then:"
      git -C "$REPO" diff --stat "$previous_full..HEAD"
    else
      reason="production runs $PREVIOUS, which is not an ancestor of HEAD ($SHORT)"
    fi
  else
    previous_full=""
    reason="production runs $PREVIOUS, a commit this repository does not have (git fetch did not bring it)"
  fi
  term=$(terminal_file)

  # Provenance (exit 2): production only goes forward unless a person at a terminal says otherwise.
  if [ -n "$reason" ]; then
    if [ "$ALLOW_DOWNGRADE" = false ]; then
      die 2 "$reason: uploading would take production back or sideways. For a deliberate downgrade set WOOW_ALLOW_DOWNGRADE=1 and answer the prompt at a terminal. Nothing was uploaded."
    fi
    if [ -z "$term" ]; then
      die 2 "$reason, and WOOW_ALLOW_DOWNGRADE=1 needs a terminal to answer at (an agent without one cannot downgrade production). Nothing was uploaded."
    fi
    confirm_from "$term" 2 "$SHA7" "$reason. Type the first 7 characters of $SHA to put it on production anyway"
  fi

  # The files that guard the deploy (exit 7): any change since production, or no production yet.
  from=$previous_full
  if [ -z "$from" ]; then from=$EMPTY_TREE; fi
  if [ -z "$previous_full" ] || ! git -C "$REPO" diff --quiet "$from" HEAD -- $GUARD_FILES; then
    hash=$(guard_diff "$from" | sha256_stdin | cut -c1-12)
    total=$(guard_diff "$from" | wc -l | tr -d '[:space:]')
    {
      if [ -z "$previous_full" ]; then
        printf 'deploy-web: there is no earlier production commit to compare with: every guard file counts as new.\n'
      else
        printf 'deploy-web: the files that guard the deploy changed since production (%s):\n' "$PREVIOUS"
      fi
      git -C "$REPO" diff --name-status --no-renames "$from" HEAD -- $GUARD_FILES
      guard_diff "$from" | head -n "$GUARD_DIFF_LINES" || true
      if [ "$total" -gt "$GUARD_DIFF_LINES" ]; then
        printf '... (%s more lines; the hash covers the whole diff)\n' "$((total - GUARD_DIFF_LINES))"
      fi
      printf 'deploy-web: the whole diff: git -C %s diff --full-index %s HEAD -- %s\n' "$REPO" "$from" "$GUARD_FILES"
      printf 'deploy-web: guard diff hash: %s\n' "$hash"
    } >&2
    if [ -n "$ACK_GUARD_DIFF" ]; then
      if [ "$ACK_GUARD_DIFF" != "$hash" ]; then
        die 7 "WOOW_ACK_GUARD_DIFF=$ACK_GUARD_DIFF is not this diff's hash ($hash): the guard files are not what was acknowledged. Nothing was uploaded."
      fi
      say "WOOW_ACK_GUARD_DIFF acknowledges the guard diff $hash"
    elif [ -n "$term" ]; then
      confirm_from "$term" 7 "$hash" "type the hash $hash to accept this change to the guard files"
    else
      die 7 "show the diff above to the owner in chat and wait for a yes; then run this script again with WOOW_ACK_GUARD_DIFF=$hash. Nothing was uploaded."
    fi
  else
    say "the guard files are unchanged since production's commit"
  fi

  # The commit itself: WOOW_CONFIRM_SHA, a prompt at a terminal, or (an agent, O12) neither.
  if [ -n "$reason" ]; then
    : # the prompt above was the confirmation
  elif [ "$CONFIRMED_BY_ENV" = true ]; then
    say "WOOW_CONFIRM_SHA confirms $SHA7"
  elif [ -n "$term" ]; then
    confirm_from "$term" 2 "$SHA7" "type the first 7 characters of $SHA to upload it to production"
  else
    say "no terminal and no WOOW_CONFIRM_SHA: uploading without a confirmation (owner decision O12)"
  fi
}
if [ "$MODE" = production ]; then
  say "production upload of $(git -C "$REPO" log -1 --format='%H %an %ad %s')"
  production_gates
fi

# --- right before the upload: the commit and the login once more (exit 2, 4) ---
check_source "right before the upload"
check_login

# --- upload (exit 5) ---
BRANCH=main
ENVIRONMENT=production
if [ "$MODE" = preview ]; then
  BRANCH=preview
  ENVIRONMENT=preview
fi
say "uploading $UPLOAD (a checked copy of $OUT) to the Pages project $PROJECT, branch $BRANCH"
# Every value shares its argument with its flag: a commit subject that begins with "-" could not
# become an option of its own (such as --cwd, which makes wrangler build ./functions as the site's Worker).
DEPLOY_CWD=$(mktemp -d "$TMP/wrangler.XXXXXX")
wr_in "$DEPLOY_CWD" pages deploy "$UPLOAD" --project-name="$PROJECT" --branch="$BRANCH" \
  --commit-hash="$SHA" --commit-message="$MSG" --commit-dirty=false --cwd="$DEPLOY_CWD" || {
  rollback_help
  die 5 "wrangler pages deploy failed"
}

# --- after the upload (exit 6, 8) ---
LIST=$(wr pages deployment list --project-name="$PROJECT" --environment="$ENVIRONMENT" --json) || {
  rollback_help
  die 6 "wrangler pages deployment list failed after the upload"
}
if ! DEPLOYED_URL=$(node -e 'const [raw, sha7, environment, branch] = process.argv.slice(1);
const list = JSON.parse(raw.slice(raw.search(/^\[/m), raw.lastIndexOf("]") + 1));
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
case "$DEPLOYED_URL" in
  https://*) ;;
  *)
    rollback_help
    die 6 "the deployment list has no address for the new deployment (\"$DEPLOYED_URL\")"
    ;;
esac

# verify_site <base url> [extra verify-live.mjs argument]: 0 when the site serves the upload,
# otherwise verify-live.mjs's last exit code (3: it did not answer at all).
verify_site() {
  local base=$1 extra=${2:-} attempt=1 rc=0
  while :; do
    rc=0
    node "$REPO/woowtech/web/verify-live.mjs" "$base" "$UPLOAD" ${extra:+"$extra"} || rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    if [ "$attempt" -ge "$VERIFY_ATTEMPTS" ]; then return "$rc"; fi
    attempt=$((attempt + 1))
    say "checking $base again in ${VERIFY_WAIT}s (attempt $attempt of $VERIFY_ATTEMPTS)"
    sleep "$VERIFY_WAIT"
  done
}
# The deployment's own address (<hash>.<project>.pages.dev) answers for this upload whatever is
# attached to the project: the Bulk Redirect sends <project>.pages.dev itself to the brand's site
# (301, not 200), but not these addresses (it does not include subdomains).
VERIFY_FLAG=""
if [ "$MODE" = preview ]; then VERIFY_FLAG=--allow-access; fi
say "checking the deployment's own address $DEPLOYED_URL"
if ! verify_site "$DEPLOYED_URL" "$VERIFY_FLAG"; then
  rollback_help
  die 6 "$DEPLOYED_URL does not serve this export (verify-live.mjs above)"
fi
if [ "$MODE" = production ] && domain_listed; then
  say "checking $SITE_ORIGIN"
  SITE_RC=0
  verify_site "$SITE_ORIGIN" || SITE_RC=$?
  if [ "$SITE_RC" -eq 3 ]; then
    die 8 "uploaded and checked at $DEPLOYED_URL, but $SITE_ORIGIN is on the project and does not answer (not Active yet?). Nothing is wrong with the deployment: no rollback. Look at Custom domains in the dashboard, then run node woowtech/web/verify-live.mjs $SITE_ORIGIN <export> by hand."
  elif [ "$SITE_RC" -ne 0 ]; then
    rollback_help
    die 6 "$SITE_ORIGIN does not serve this export (verify-live.mjs above)"
  fi
  CHECKED="$DEPLOYED_URL and $SITE_ORIGIN"
else
  CHECKED=$DEPLOYED_URL
fi
say "done: $SHA7 is the $ENVIRONMENT deployment of $PROJECT, checked at $CHECKED; the wrangler login stays (O12)"
