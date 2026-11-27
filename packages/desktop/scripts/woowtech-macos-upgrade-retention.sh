#!/usr/bin/env bash
# Upgrade data retention on a disposable macOS runner: install a published build, let it save data,
# install another build over it, and check that the data survived (e2e/upgrade-retention.js).
# It builds, signs and publishes nothing.
#
# The new build is, in order of precedence: $CANDIDATE_APP (an already unpacked app, run in place)
# or the published $TO_VERSION.
set -euo pipefail

for variable in BRAND APP_NAME ARTIFACT_PREFIX RELEASES_REPO FROM_VERSION TO_VERSION SOURCE_ROOT DIAGNOSTICS_DIR; do
  : "${!variable:?$variable is required}"
done
CANDIDATE_APP="${CANDIDATE_APP:-}"
case "$(uname -m)" in
  arm64) DMG_ARCH=arm64 ;;
  x86_64) DMG_ARCH=x64 ;;
  *) echo "Unsupported machine $(uname -m)" >&2; exit 1 ;;
esac

WORK="${RUNNER_TEMP:-/tmp}/upgrade-retention"
STATE="$WORK/state"
APPS="$HOME/Applications"
APP="$APPS/$APP_NAME.app"
CHECK="$SOURCE_ROOT/packages/desktop/e2e/upgrade-retention.js"
mkdir -p "$STATE" "$APPS" "$DIAGNOSTICS_DIR"
export PASEO_SMOKE_BRAND="$BRAND"

stop_apps() {
  # The app leaves its daemon behind, and an app that is still running cannot be replaced cleanly.
  pkill -f "$APP/Contents/" 2>/dev/null || true
  if [ -n "$CANDIDATE_APP" ]; then pkill -f "$CANDIDATE_APP/Contents/" 2>/dev/null || true; fi
  sleep 3
}

collect() {
  stop_apps
  find "$STATE" -maxdepth 1 -type f -exec cp {} "$DIAGNOSTICS_DIR"/ \;
}
trap collect EXIT

download_published_dmg() {
  local version="$1" dir="$WORK/published-$1"
  rm -rf "$dir"
  gh release download "v$version" --repo "$RELEASES_REPO" --pattern "$ARTIFACT_PREFIX-$version-$DMG_ARCH.dmg" --dir "$dir" >&2
  ls "$dir"/*.dmg
}

install_from_dmg() {
  local dmg="$1" mount
  mount="$(mktemp -d)"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" > /dev/null
  stop_apps
  rm -rf "$APP"
  ditto "$mount/$APP_NAME.app" "$APP"
  hdiutil detach "$mount" > /dev/null
  codesign --verify --deep --strict "$APP"
  spctl --assess --type execute -vv "$APP"
}

installed_version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist"
}

install_from_dmg "$(download_published_dmg "$FROM_VERSION")"
[ "$(installed_version)" = "$FROM_VERSION" ] || { echo "Installed $(installed_version) instead of $FROM_VERSION" >&2; exit 1; }
echo "Previous build $FROM_VERSION installed at $APP"
node "$CHECK" --phase seed --app "$APP" --state "$STATE" --real-dirs --label "$FROM_VERSION"
stop_apps

NEW_APP="$APP"
if [ -n "$CANDIDATE_APP" ]; then
  NEW_APP="$CANDIDATE_APP"
  echo "New build runs in place from $NEW_APP"
else
  install_from_dmg "$(download_published_dmg "$TO_VERSION")"
  [ "$(installed_version)" = "$TO_VERSION" ] || { echo "Installed $(installed_version) after the upgrade instead of $TO_VERSION" >&2; exit 1; }
  echo "Upgraded in place to $TO_VERSION"
fi
node "$CHECK" --phase verify --app "$NEW_APP" --state "$STATE" --real-dirs --expect-version "$TO_VERSION" --label "$FROM_VERSION"
