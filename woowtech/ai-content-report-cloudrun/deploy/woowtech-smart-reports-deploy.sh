#!/usr/bin/env bash
# Deploys a brand's AI content report receiver: Cloud Run service smart-reports in the brand's
# project and region (woowtech smart: woowtech-smart, asia-east1; Apporo smart: apporo-smart-app,
# us-west1, behind www.apporo.ai/api/smart/...), storing reports in the (default) Firestore
# database that smart-push uses, with an e-mail alert for every stored report. It follows
# smart-push's deploy script (refs/woowtech-push-relay/deploy/woowtech-smart-deploy.sh), with one
# difference: nothing is changed unless --apply is given.
#
# Run it in Google Cloud Shell, logged in as an Owner of the project, from a clean clone:
#   ./woowtech-smart-reports-deploy.sh                 # prints the plan and every command; calls nothing
#   ./woowtech-smart-reports-deploy.sh --apply         # prints the plan, asks, then deploys
#   ./woowtech-smart-reports-deploy.sh --apply check   # runs one step only (names below)
#   ./woowtech-smart-reports-deploy.sh rollback        # prints the commands that undo it
#
# Options:
#   --apply    run the steps; without it nothing is called (no gcloud, curl or openssl)
#   --dry-run  the default, spelled out; wins over --apply
#   --yes      do not ask for confirmation (required with --apply when stdin is not a terminal)
#   --brand=ID whose receiver: woowtech (the default) or apporo (woowtech/brands/<ID>.json)
#   --help     show this text
# Steps, always run in this order, all of them when none is named:
#   apis      enable the Google APIs
#   firestore the (default) database must be Native mode in the brand's region (created only if missing)
#   ttl       Firestore TTL on the field expiresAt of both collections
#   iam       service account smart-reports with the one project role it needs
#   secret    the edge key secret (32 random bytes, created once, never printed)
#   build     Artifact Registry repository and the image of the checked-out commit
#   logs      keep Cloud Run request logs of the service out of Cloud Logging
#   deploy    the Cloud Run service
#   alert     e-mail notification channel and the log-based alerting policy
#   check     read-only checks of the deployed service (nothing is stored)
# PROJECT_ID overrides the brand's project, for example for a staging project; NOTIFY_EMAIL the
# alert address.
# The alert step uses "gcloud beta" (an e-mail notification channel can only be created there).
# Cloud Shell has the beta component; elsewhere install it first: gcloud components install beta
#
# Safe to run again: resources are created only when missing, the edge key secret is never
# replaced, and a second run builds and deploys a new revision of the checked-out commit.
# Done by a human first: Blaze billing and a budget alert on the project, the reviewed commit
# checked out, gcloud logged in. Afterwards in Cloudflare: see "Next" at the end of a run.
set -euo pipefail

# Probes discard gcloud output, so an interactive prompt would hang with nothing on screen.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

ALL_STEPS="apis firestore ttl iam secret build logs deploy alert check"
APPLY=0
FORCE_DRY=0
ASSUME_YES=0
ROLLBACK=0
REQUESTED=""
BRAND=woowtech
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --brand=*) BRAND="${arg#--brand=}" ;;
    --dry-run) FORCE_DRY=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    rollback) ROLLBACK=1 ;;
    apis | firestore | ttl | iam | secret | build | logs | deploy | alert | check)
      REQUESTED="$REQUESTED $arg"
      ;;
    *)
      printf 'Unknown option or step: %s\n\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done
if [ "$ROLLBACK" = 1 ] && [ -n "$REQUESTED" ]; then
  printf 'rollback takes no step names\n\n' >&2
  usage >&2
  exit 2
fi
if [ "$APPLY" = 1 ] && [ "$FORCE_DRY" = 0 ]; then DRY_RUN=0; else DRY_RUN=1; fi

# Each brand's receiver: its name in mails and plans, Google Cloud project and region, the address
# its Cloudflare Worker serves and that Worker's wrangler config and setup. A test keeps the address
# and the name equal to the brand's file.
case "$BRAND" in
  woowtech)
    PRODUCT="woowtech smart"
    BRAND_PROJECT_ID=woowtech-smart
    REGION=asia-east1
    PUBLIC_HOST=reports.woowtech.io
    PUBLIC_PATH=/v1/ai-content-reports
    WRANGLER_CONFIG=cloudflare-worker-smart-reports.wrangler.jsonc
    # The Worker's defaults are woowtech smart's, so its dashboard settings need no more.
    WORKER_VARS_NOTE=""
    WORKER_ENTRY="the custom domain reports.woowtech.io"
    WORKER_ENTRY_NOTE=""
    RATE_TARGET="the host reports.woowtech.io"
    PLAN_NOTE=" 4. The Cloudflare account must be on Workers Paid, which has no daily request limit. On Workers Free
    all Workers of the account share 100,000 requests a day and stop serving once they are used up,
    until 00:00 UTC (error 1027)."
    ;;
  apporo)
    PRODUCT="Apporo smart"
    BRAND_PROJECT_ID=apporo-smart-app
    REGION=us-west1
    # One path on the Apporo website, as Apporo aiot's Worker serves www.apporo.ai/api/*.
    PUBLIC_HOST=www.apporo.ai
    PUBLIC_PATH=/api/smart/v1/ai-content-reports
    WRANGLER_CONFIG=cloudflare-worker-smart-reports.apporo.wrangler.jsonc
    WORKER_VARS_NOTE="
    In the dashboard, also add the text variables PUBLIC_HOST=www.apporo.ai,
    PUBLIC_PATH=/api/smart/v1/ai-content-reports and ALLOWED_ORIGINS=apporosmart://app (the wrangler
    config has all three)."
    WORKER_ENTRY="the route www.apporo.ai/api/smart/v1/ai-content-reports"
    WORKER_ENTRY_NOTE=" (zone apporo.ai, never a
    wildcard: it is the Apporo website; it is more specific than Apporo aiot's www.apporo.ai/api/*)"
    RATE_TARGET="that path, never the whole host"
    PLAN_NOTE=" 4. The Worker runs on the account's plan, as Apporo aiot's Worker does. On Workers Free all Workers
    of the account share 100,000 requests a day and stop serving once they are used up, until 00:00 UTC."
    ;;
  *)
    printf 'Unknown brand: %s\n\n' "$BRAND" >&2
    usage >&2
    exit 2
    ;;
esac
ZONE="${PUBLIC_HOST#*.}"
PROJECT_ID="${PROJECT_ID:-$BRAND_PROJECT_ID}"
SERVICE=smart-reports
REPO=smart-reports
SA_NAME=smart-reports
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SECRET=smart-reports-edge-key
EXCLUSION=smart-reports-requests
MAX_INSTANCES=3
CONCURRENCY=80
# Cloud Run's smallest memory limit for the second generation execution environment.
MEMORY=512Mi
RETENTION_DAYS=30
DAILY_MAX=2000
REPORT_PATH=/v1/ai-content-reports
REPORTS_GROUP=aiContentReports
COUNTERS_GROUP=aiContentReportCounters
NOTIFY_EMAIL="${NOTIFY_EMAIL:-woowtech@designsmart.com.tw}"
CHANNEL_NAME="${PRODUCT} AI reports (email)"
# The displayName of smart-reports-alert-policy.json once __PRODUCT__ is filled in (a test checks).
POLICY_NAME="${PRODUCT}: new AI content report"
APIS="run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
  firestore.googleapis.com logging.googleapis.com monitoring.googleapis.com
  secretmanager.googleapis.com iam.googleapis.com"
PROJECT_ROLES="roles/datastore.user"
REQUEST_LOG_FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND logName:\"run.googleapis.com%2Frequests\""
SMOKE_RETRY_SECONDS="${SMOKE_RETRY_SECONDS:-5}"
IAM_RETRY_SECONDS="${IAM_RETRY_SECONDS:-10}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
POLICY_TEMPLATE="${SCRIPT_DIR}/smart-reports-alert-policy.json"

# fd 3 is the terminal even inside $(...), so probes can show themselves while being captured.
exec 3>&1

die() {
  printf '\nSTOPPED: %s\n' "$*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed or not on PATH"; }

# The alerting policy file is written to a private temporary directory and removed on exit.
WORK_DIR=""
cleanup() {
  if [ -n "$WORK_DIR" ]; then
    rm -f "${WORK_DIR}/alert-policy.json"
    rmdir "$WORK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT
step() { printf '\n== %s\n' "$*" >&3; }
note() { printf '   = %s\n' "$*" >&3; }

# Prints a command so it can be pasted into a shell: $1 is the marker (+ changes, ? reads).
show() {
  local marker="$1" line="" arg quoted
  shift
  for arg in "$@"; do
    case "$arg" in
      *[!A-Za-z0-9_@%+=:,./-]*)
        quoted="$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")"
        line="$line '$quoted'"
        ;;
      *) line="$line $arg" ;;
    esac
  done
  printf '   %s%s\n' "$marker" "$line" >&3
}

# A gcloud command that changes something: shown, then run. A dry run only shows it.
act() {
  show '+' gcloud --project "$PROJECT_ID" "$@"
  if [ "$DRY_RUN" = 0 ]; then
    gcloud --project "$PROJECT_ID" "$@"
  fi
}

# Like act, for a command whose output the caller keeps (a new resource's name). A dry run prints
# $1 in its place.
act_value() {
  local placeholder="$1"
  shift
  show '+' gcloud --project "$PROJECT_ID" "$@"
  if [ "$DRY_RUN" = 1 ]; then
    printf '%s\n' "$placeholder"
    return 0
  fi
  gcloud --project "$PROJECT_ID" "$@"
}

# Like act, for IAM bindings on a service account that may be seconds old and not yet visible.
act_iam() {
  local attempt
  show '+' gcloud --project "$PROJECT_ID" "$@"
  if [ "$DRY_RUN" = 1 ]; then
    return 0
  fi
  for attempt in 1 2 3 4 5; do
    if gcloud --project "$PROJECT_ID" "$@"; then
      return 0
    fi
    if [ "$attempt" = 5 ]; then
      return 1
    fi
    printf '   (the new service account may not be visible to IAM yet; retrying in %s s)\n' "$IAM_RETRY_SECONDS" >&3
    sleep "$IAM_RETRY_SECONDS"
  done
}

# A read-only gcloud call whose output the caller uses. A dry run shows it and reports "not
# found", so the dry run lists everything a first run on an empty project would do.
probe() {
  show '?' gcloud --project "$PROJECT_ID" "$@"
  if [ "$DRY_RUN" = 1 ]; then
    return 1
  fi
  gcloud --project "$PROJECT_ID" "$@" 2>/dev/null
}

SMOKE_FAILED=""
RUN_URL=""
expect_status() {
  local want="$1" method="$2" url="$3" got="" attempt
  local request=(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X "$method")
  if [ "$method" = POST ]; then
    request+=(-H 'content-type: application/json' -d '{}')
  fi
  request+=("$url")
  show '?' "${request[@]}"
  if [ "$DRY_RUN" = 1 ]; then
    return 0
  fi
  for attempt in 1 2 3; do
    got="$("${request[@]}" || true)"
    if [ "$got" = "$want" ]; then
      note "$method ${url#"$RUN_URL"} answered $got as expected"
      return 0
    fi
    sleep "$SMOKE_RETRY_SECONDS"
  done
  printf '   ! %s %s answered %s, expected %s\n' "$method" "${url#"$RUN_URL"}" "$got" "$want" >&3
  SMOKE_FAILED="${SMOKE_FAILED} ${url#"$RUN_URL"}"
}

selected() {
  case " ${REQUESTED:-$ALL_STEPS} " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

if [ "$ROLLBACK" = 1 ]; then
  cat >&3 <<EOF
Rollback of the AI content report receiver in project ${PROJECT_ID}. This script runs none of it:
run what you need, in this order. Nothing here touches the Apps or smart-push.
 1. Cloudflare: remove ${WORKER_ENTRY} from the Worker smart-reports-proxy,
    then delete the Worker (and its rate limiting rule, if you made one). The App then cannot send
    reports and says so.
 2. The stored reports. Deleting the service does not delete them, and they are only removed by the
    TTL policy (step 9 turns that off), so delete them first, in the Google Cloud console: Firestore
    > Data > collection ${REPORTS_GROUP} > Delete collection, and the same for ${COUNTERS_GROUP}.
 3. gcloud --project ${PROJECT_ID} run services delete ${SERVICE} --region ${REGION}
 4. gcloud --project ${PROJECT_ID} monitoring policies list --filter='displayName="${POLICY_NAME}"' --format='value(name)'
    gcloud --project ${PROJECT_ID} monitoring policies delete <the name printed above>
 5. gcloud --project ${PROJECT_ID} beta monitoring channels list --filter='displayName="${CHANNEL_NAME}"' --format='value(name)'
    gcloud --project ${PROJECT_ID} beta monitoring channels delete <the name printed above>
 6. gcloud --project ${PROJECT_ID} logging sinks update _Default --remove-exclusions=${EXCLUSION}
 7. gcloud --project ${PROJECT_ID} artifacts repositories delete ${REPO} --location ${REGION}
 8. gcloud --project ${PROJECT_ID} secrets delete ${SECRET}
 9. gcloud --project ${PROJECT_ID} firestore fields ttls update expiresAt --collection-group=${REPORTS_GROUP} --disable-ttl
    gcloud --project ${PROJECT_ID} firestore fields ttls update expiresAt --collection-group=${COUNTERS_GROUP} --disable-ttl
10. gcloud --project ${PROJECT_ID} projects remove-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:${SA} --role=roles/datastore.user
    gcloud --project ${PROJECT_ID} iam service-accounts delete ${SA}
The (default) Firestore database and the enabled APIs stay: smart-push uses them.
EOF
  exit 0
fi

COMMIT=""
UNCOMMITTED=""
if git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  COMMIT="$(git -C "$APP_DIR" rev-parse --short=12 HEAD)"
  # Only this folder goes into the image, so only changes here matter.
  UNCOMMITTED="$(git -C "$APP_DIR" status --porcelain -- .)"
fi
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${COMMIT:-<commit>}"
if [ -z "$COMMIT" ]; then
  SOURCE_STATE="not a git checkout: a real run of build or deploy stops here"
elif [ -n "$UNCOMMITTED" ]; then
  SOURCE_STATE="UNCOMMITTED CHANGES: a real run of build or deploy stops here"
else
  SOURCE_STATE="clean"
fi
if [ "$DRY_RUN" = 1 ]; then
  MODE_NOTE=" (DRY RUN: nothing is called)"
else
  MODE_NOTE=""
fi

TOTAL=0
for name in $ALL_STEPS; do
  if selected "$name"; then TOTAL=$((TOTAL + 1)); fi
done

cat >&3 <<EOF
${PRODUCT} AI content report receiver: deployment plan${MODE_NOTE}
  project          ${PROJECT_ID}
  region           ${REGION}
  steps            ${REQUESTED:-all of them}
  source           ${APP_DIR} at ${COMMIT:-?} (${SOURCE_STATE})
  image            ${IMAGE}
  service          ${SERVICE}: at most ${MAX_INSTANCES} instances, ${MEMORY}, concurrency ${CONCURRENCY},
                   RETENTION_DAYS=${RETENTION_DAYS}, at most ${DAILY_MAX} reports a day (then 429);
                   reachable without Google sign-in; the service itself refuses every request
                   without the Cloudflare edge key
  service account  ${SA}
                   ${PROJECT_ROLES// /, } on the project (Firestore only; no logging role: Cloud Run
                   collects the container's logs itself),
                   roles/secretmanager.secretAccessor on the secret ${SECRET} only
  edge key         secret ${SECRET}: 32 random bytes if it does not exist yet; never printed,
                   never replaced by this script
  Firestore        (default) database, Native mode, ${REGION} (it exists for smart-push);
                   collections ${REPORTS_GROUP} and ${COUNTERS_GROUP}, TTL on expiresAt in both
  request logs     Cloud Run request logs of ${SERVICE} excluded from the _Default sink (${EXCLUSION})
  alert            e-mail to ${NOTIFY_EMAIL} for every stored report (log-based alerting policy;
                   Google allows 20 such e-mails a day per policy)
Steps below: "?" only reads, "+" changes something.
EOF
if [ "$DRY_RUN" = 1 ]; then
  printf 'Dry run: every "?" is treated as "not found", so this is what a first run does.\n' >&3
  printf 'Add --apply to run it.\n' >&3
fi

if [ "$DRY_RUN" = 0 ]; then
  need gcloud
  if selected secret; then need openssl; fi
  if selected check; then need curl; fi
  if selected build || selected deploy; then
    need git
    [ -n "$COMMIT" ] ||
      die "$APP_DIR is not a git checkout: deploy from a clone so the image matches a commit"
    [ -z "$UNCOMMITTED" ] ||
      die "$APP_DIR has uncommitted changes; commit or discard them so the image matches ${COMMIT}"
  fi
  if [ "$ASSUME_YES" = 0 ] && [ ! -t 0 ]; then
    die "stdin is not a terminal; rerun with --yes to run without the prompt"
  fi
  account="$(probe auth list --filter=status:ACTIVE --format='value(account)' || true)"
  [ -n "$account" ] || die "gcloud has no active account; run: gcloud auth login"
  note "gcloud account: ${account%%$'\n'*}"
  if [ "$ASSUME_YES" = 0 ]; then
    printf '\nType the project ID (%s) to run this; anything else stops: ' "$PROJECT_ID" >&3
    read -r answer
    [ "$answer" = "$PROJECT_ID" ] || die "not confirmed; nothing was changed"
  fi
fi

run_apis() {
  step "${STEP_LABEL} apis: enable the Google APIs"
  # shellcheck disable=SC2086 # word splitting of the list is intended
  act services enable $APIS
}

run_firestore() {
  step "${STEP_LABEL} firestore: the (default) database, Native mode, ${REGION}"
  local existing location mode
  if existing="$(probe firestore databases describe --database='(default)' --format='value(locationId,type)')"; then
    read -r location mode <<<"$existing"
    if [ "$location" != "$REGION" ] || [ "$mode" != FIRESTORE_NATIVE ]; then
      die "the (default) Firestore database already exists as ${mode:-?} in ${location:-?}, and it cannot be moved; decide with the owner before deploying"
    fi
    note "exists: Native mode in ${REGION}"
  else
    act firestore databases create --database='(default)' --location="$REGION" --type=firestore-native
  fi
}

run_ttl() {
  step "${STEP_LABEL} ttl: Firestore deletes a report after its expiresAt (${RETENTION_DAYS} days), typically within 24 hours"
  local group listed
  for group in "$REPORTS_GROUP" "$COUNTERS_GROUP"; do
    listed="$(probe firestore fields ttls list --collection-group="$group" --format='value(name)' || true)"
    case "$listed" in
      */fields/expiresAt*) note "TTL already set on ${group}.expiresAt" ;;
      *) act firestore fields ttls update expiresAt --collection-group="$group" --enable-ttl --quiet ;;
    esac
  done
}

run_iam() {
  step "${STEP_LABEL} iam: service account ${SA_NAME} with only the role the receiver needs"
  local role
  if probe iam service-accounts describe "$SA" --format='value(email)' >/dev/null; then
    note "exists: ${SA}"
  else
    act iam service-accounts create "$SA_NAME" --display-name="${PRODUCT} AI report receiver"
  fi
  for role in $PROJECT_ROLES; do
    act_iam projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA}" \
      --role="$role" --condition=None --quiet --format=none
  done
}

run_secret() {
  step "${STEP_LABEL} secret: edge key ${SECRET} (the Cloudflare Worker adds it; the receiver requires it)"
  if probe secrets describe "$SECRET" --format='value(name)' >/dev/null; then
    note "exists: kept as it is"
  else
    show '+' gcloud --project "$PROJECT_ID" secrets create "$SECRET" \
      --replication-policy=user-managed --locations="$REGION" --data-file=-
    printf '     stdin: openssl rand -hex 32 (the value is never printed)\n' >&3
    if [ "$DRY_RUN" = 0 ]; then
      openssl rand -hex 32 | tr -d '\n' |
        gcloud --project "$PROJECT_ID" secrets create "$SECRET" \
          --replication-policy=user-managed --locations="$REGION" --data-file=-
    fi
  fi
  act_iam secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:${SA}" \
    --role=roles/secretmanager.secretAccessor --condition=None --quiet --format=none
}

run_build() {
  step "${STEP_LABEL} build: image ${IMAGE}"
  if probe artifacts repositories describe "$REPO" --location="$REGION" --format='value(name)' >/dev/null; then
    note "Artifact Registry repository ${REPO} exists"
  else
    act artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"
  fi
  # In apporo-smart-app, Cloud Build runs as the Compute Engine default service account, and gcloud
  # cannot stream such a build's logs from the default logs bucket: the build succeeds but `builds
  # submit` exits 1. --suppress-logs waits for the build and exits with its result; gcloud still
  # prints where the logs are.
  act builds submit "$APP_DIR" --tag "$IMAGE" --suppress-logs
}

run_logs() {
  step "${STEP_LABEL} logs: keep request logs of ${SERVICE} out of Cloud Logging (they hold client IP and User-Agent)"
  local exclusions
  exclusions="$(probe logging sinks describe _Default --format='value(exclusions[].name)' || true)"
  case ";$(printf '%s' "$exclusions" | tr ',\n\t ' ';;;;');" in
    *";${EXCLUSION};"*) note "exclusion ${EXCLUSION} exists" ;;
    *) act logging sinks update _Default --add-exclusion="name=${EXCLUSION},filter=${REQUEST_LOG_FILTER}" ;;
  esac
}

run_deploy() {
  step "${STEP_LABEL} deploy: ${SERVICE}"
  act run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
    --allow-unauthenticated --max-instances "$MAX_INSTANCES" --concurrency "$CONCURRENCY" \
    --memory "$MEMORY" \
    --set-env-vars "RETENTION_DAYS=${RETENTION_DAYS},DAILY_MAX_REPORTS=${DAILY_MAX},GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
    --set-secrets "EDGE_KEYS=${SECRET}:latest"
}

# The alerting policy for the notification channel $1: the template with its blanks filled in.
render_policy() {
  sed -e "s|__CHANNEL__|$1|g" -e "s|__PRODUCT__|${PRODUCT}|g" -e "s|__PROJECT__|${PROJECT_ID}|g" \
    "$POLICY_TEMPLATE"
}

run_alert() {
  step "${STEP_LABEL} alert: e-mail ${NOTIFY_EMAIL} for every stored report"
  local channel channel_status policy policy_file
  case "$NOTIFY_EMAIL" in
    *?@?*.?*) ;;
    *) die "NOTIFY_EMAIL is not an e-mail address" ;;
  esac
  [ -f "$POLICY_TEMPLATE" ] || die "missing ${POLICY_TEMPLATE}"

  channel="$(probe beta monitoring channels list --filter="displayName=\"${CHANNEL_NAME}\"" --format='value(name)' || true)"
  channel="${channel%%$'\n'*}"
  if [ -n "$channel" ]; then
    note "notification channel exists: ${channel}"
  else
    channel="$(act_value "projects/${PROJECT_ID}/notificationChannels/<new channel id>" \
      beta monitoring channels create --display-name="$CHANNEL_NAME" --type=email \
      --channel-labels="email_address=${NOTIFY_EMAIL}" --format='value(name)')"
    channel="${channel%%$'\n'*}"
  fi
  if [ "$DRY_RUN" = 0 ]; then
    case "$channel" in
      projects/*/notificationChannels/*) ;;
      *) die "gcloud did not return the notification channel's name" ;;
    esac
  fi
  channel_status="$(probe beta monitoring channels describe "$channel" --format='value(verificationStatus)' || true)"
  case "$channel_status" in
    UNVERIFIED) note "the channel is UNVERIFIED: open the mail Google sent to ${NOTIFY_EMAIL} and confirm it, or no alert is delivered" ;;
    VERIFIED) note "the channel is verified" ;;
    *) note "verification status of the channel: ${channel_status:-not reported}; if it says UNVERIFIED, confirm the mail Google sent to ${NOTIFY_EMAIL}" ;;
  esac

  policy="$(probe monitoring policies list --filter="displayName=\"${POLICY_NAME}\"" --format='value(name)' || true)"
  policy="${policy%%$'\n'*}"
  if [ -n "$policy" ]; then
    note "alerting policy exists: ${policy} (to change it, delete it in the console and run this step again)"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then
    policy_file="/tmp/smart-reports-alert-policy.json"
  else
    WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/smart-reports-deploy.XXXXXX")"
    policy_file="${WORK_DIR}/alert-policy.json"
    render_policy "$channel" >"$policy_file"
  fi
  printf '   the policy file (%s):\n' "$policy_file" >&3
  render_policy "$channel" | sed 's/^/     | /' >&3
  act monitoring policies create --policy-from-file="$policy_file" --format=none
}

run_check() {
  step "${STEP_LABEL} check: the deployed service answers as the report receiver should (nothing is stored)"
  local url revision started="" attempt filter
  RUN_URL="https://${SERVICE}-<hash>-de.a.run.app"
  if url="$(probe run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')" && [ -n "$url" ]; then
    RUN_URL="$url"
  fi
  expect_status 200 GET "${RUN_URL}/health"
  expect_status 403 POST "${RUN_URL}${REPORT_PATH}"
  expect_status 405 GET "${RUN_URL}${REPORT_PATH}"
  expect_status 404 POST "${RUN_URL}/"

  revision="<latest revision>"
  if url="$(probe run services describe "$SERVICE" --region "$REGION" --format='value(status.latestReadyRevisionName)')" && [ -n "$url" ]; then
    revision="$url"
  fi
  # The alert reads the service's logs, so the check proves they reach Cloud Logging: the service
  # writes this line each time an instance starts, and the requests above have started one.
  filter="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND resource.labels.revision_name=\"${revision}\" AND jsonPayload.event=\"ai_report_receiver_started\""
  show '?' gcloud --project "$PROJECT_ID" logging read "$filter" --limit=1 --freshness=30d --format='value(timestamp)'
  if [ "$DRY_RUN" = 0 ]; then
    for attempt in 1 2 3 4 5 6; do
      started="$(gcloud --project "$PROJECT_ID" logging read "$filter" --limit=1 --freshness=30d --format='value(timestamp)' 2>/dev/null || true)"
      if [ -n "$started" ]; then
        break
      fi
      sleep "$SMOKE_RETRY_SECONDS"
    done
    if [ -n "$started" ]; then
      note "start-up log line found (${started%%$'\n'*}): Cloud Logging receives the service's logs"
    else
      SMOKE_FAILED="${SMOKE_FAILED} start-up-log-line"
    fi
  fi

  if [ -n "$SMOKE_FAILED" ]; then
    cat >&2 <<EOF

STOPPED: the service does not behave as the report receiver should (${SMOKE_FAILED# }).
Do not point Cloudflare at it yet.
- Everything 403, including /health: the organisation may block public (allUsers) access. Try
    gcloud --project ${PROJECT_ID} run services update ${SERVICE} --region ${REGION} --no-invoker-iam-check
- /health does not answer 200: the container did not start. Read why with
    gcloud --project ${PROJECT_ID} run services logs read ${SERVICE} --region ${REGION} --limit 30
- POST ${REPORT_PATH} without a key is not 403: the edge key is not enforced; check EDGE_KEYS and the logs.
- No start-up log line: the alert would never fire. Look at Logs Explorer for the service, and at the
  _Default sink's exclusions (gcloud --project ${PROJECT_ID} logging sinks describe _Default). If the
  container's logs really are missing, grant the service account the logging role:
    gcloud --project ${PROJECT_ID} projects add-iam-policy-binding ${PROJECT_ID} --member=serviceAccount:${SA} --role=roles/logging.logWriter
EOF
    exit 1
  fi
}

STEP_LABEL=""
n=0
for name in $ALL_STEPS; do
  if selected "$name"; then
    n=$((n + 1))
    STEP_LABEL="${n}/${TOTAL}"
    "run_${name}"
  fi
done

if selected deploy || selected check; then
  DONE_NOTE=""
  if [ "$DRY_RUN" = 1 ]; then
    DONE_NOTE=" (dry run: nothing was deployed)"
  fi
  if [ -z "$RUN_URL" ]; then
    RUN_URL="https://${SERVICE}-<hash>-de.a.run.app"
    if url="$(probe run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')" && [ -n "$url" ]; then
      RUN_URL="$url"
    fi
  fi
  cat >&3 <<EOF

Done${DONE_NOTE}. Cloud Run URL: ${RUN_URL}
Next, in Cloudflare (the account that holds the ${ZONE} zone):
 1. Worker smart-reports-proxy: paste deploy/cloudflare-worker-smart-reports.js into a new Worker, or
    deploy it with wrangler 4.36+ and deploy/${WRANGLER_CONFIG}, which also
    adds the per-IP limit binding. Set its RELAY_ORIGIN to that URL, and its EDGE_KEY secret to the
    output of
      gcloud --project ${PROJECT_ID} secrets versions access latest --secret ${SECRET}
    pasted straight into the Cloudflare secret field (not into chat or documents). That output is one
    key, except while the key is being rotated (below).${WORKER_VARS_NOTE}
 2. Give the Worker ${WORKER_ENTRY}${WORKER_ENTRY_NOTE}. In the Worker's Settings > Domains & Routes,
    turn off workers.dev and Preview URLs: those addresses are outside the ${ZONE} zone and its
    per-IP rate limit. The Worker answers 404 on them anyway; turning them off removes them.
 3. The per-IP limit: the wrangler config's IP_RATE_LIMITER binding (10 requests a minute per IP,
    counted per Cloudflare location), or a WAF rate limiting rule on ${RATE_TARGET}.
${PLAN_NOTE}
Then check the Worker and the key without storing anything: this must print the 400 below, which only a
request that passed the Worker and carried the right edge key can get:
  curl -s -X POST https://${PUBLIC_HOST}${PUBLIC_PATH} -H 'content-type: application/json' -d '{}'
  {"error":"unsupported_schema"}
The e-mail alert is only proven by a real report: send one from the App and wait a few minutes. If the
channel above said UNVERIFIED, confirm the mail Google sent to ${NOTIFY_EMAIL} first.
To rotate the key later:
  1. Add a version of ${SECRET} holding the old and the new key, separated by a space
     ("old new"), and run this script again with --apply deploy: the receiver then accepts both.
  2. Set the Worker's EDGE_KEY to the NEW key only, the second word of that version:
       gcloud --project ${PROJECT_ID} secrets versions access latest --secret ${SECRET} | cut -d ' ' -f 2
     Never paste the whole "old new" string: the Worker would send it as one key, and the receiver
     would answer every request 403.
  3. Add a version holding only the new key and run --apply deploy again.
EOF
fi
