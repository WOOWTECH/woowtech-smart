#!/bin/bash
# Bring up everything the Android emulator test needs, in order, on this Mac.
#
#   android-test-up.sh          # daemon + emulator + Metro + install + launch
#
# Prerequisite: the debug APK from build-android.sh. Every long-running piece is
# started through run-bg.sh, so logs land in ~/.local/share/woowtech-smart/logs
# and survive a Claude Code restart.
#
# Networking: `adb reverse` maps the emulator's localhost:8081 (Metro) and
# localhost:6768 (dev daemon) onto the Mac, so the app uses exactly the same
# endpoints as the iOS simulator and nothing has to know about 10.0.2.2.
# (The daemon would also accept 10.0.2.2 — its Host allowlist admits every IP
# address by default — but one set of endpoints for both platforms is simpler.)
#
# Memory: this machine has 8 GB. The AVD is capped at 2 GB / 2 cores, and the
# iOS simulator should be shut down first.
#
# DEVICE TARGETING: every adb call is pinned to the emulator's serial via
# ANDROID_SERIAL, and anything that is not `emulator-*` is refused. A Pixel 7a
# is paired with this Mac over wireless debugging; the first adb command
# auto-connects it. On 2026-09-24 the emulator failed to start, an unpinned
# `adb shell getprop sys.boot_completed` answered from the Pixel instead, and
# the script went on to install the debug build onto that phone. Never again.
set -euo pipefail

W="$HOME/.local/share/woowtech-smart"
. "$W/env.sh"
APK="$HOME/projects/woowtech-smart/packages/app/android/app/build/outputs/apk/debug/app-debug.apk"
PKG=sh.paseo.debug
[ -f "$APK" ] || { echo "no APK at $APK — run build-android.sh first" >&2; exit 1; }

up() { curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null || true; }
wait_for() {  # wait_for <seconds> <description> <test command...>
  local secs=$1 what=$2; shift 2
  for _ in $(seq 1 "$secs"); do "$@" && { echo "  ok: $what"; return 0; }; sleep 1; done
  echo "  TIMEOUT: $what" >&2; return 1
}

echo "1/5 dev daemon"
[ "$(up http://127.0.0.1:6768/api/health)" = 200 ] || "$W/run-bg.sh" dev-daemon "$W/dev-daemon.sh"
wait_for 90 "daemon healthy" bash -c '[ "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6768/api/health)" = 200 ]'

echo "2/5 emulator"
# The system image lives on the external WOOW-BUILD drive (system.img is a
# symlink into /Volumes/WOOW-BUILD, moved there to save internal disk). When the
# drive is not mounted the emulator dies with "No initial system image".
IMG="$ANDROID_HOME/system-images/android-36/google_apis/arm64-v8a/system.img"
[ -e "$IMG" ] || { echo "  system image missing: $(readlink "$IMG" || echo "$IMG") — plug in the WOOW-BUILD drive" >&2; exit 1; }
emu_serial() { adb devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1; exit}'; }
if [ -z "$(emu_serial)" ]; then
  "$W/run-bg.sh" emulator emulator @woowtech_smart -cores 2 -no-boot-anim -no-snapshot
fi
for _ in $(seq 1 120); do
  [ -n "$(emu_serial)" ] && break
  grep -q '^EXIT=' "$W/logs/emulator.log" 2>/dev/null && { echo "  emulator exited:" >&2; tail -3 "$W/logs/emulator.log" >&2; exit 1; }
  sleep 1
done
ANDROID_SERIAL=$(emu_serial)
case "$ANDROID_SERIAL" in emulator-*) export ANDROID_SERIAL ;; *) echo "  no emulator appeared in adb; refusing to continue" >&2; exit 1 ;; esac
echo "  target: $ANDROID_SERIAL (all adb calls pinned to it)"
wait_for 300 "emulator booted" bash -c '[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]'

echo "3/5 adb reverse"
adb reverse tcp:8081 tcp:8081 >/dev/null
adb reverse tcp:6768 tcp:6768 >/dev/null
adb reverse --list

echo "4/5 Metro"
if [ "$(up http://127.0.0.1:8081/status)" != 200 ]; then
  "$W/run-bg.sh" metro bash -c "cd '$HOME/projects/woowtech-smart/packages/app' && \
    APP_VARIANT=development EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_LOCAL_DAEMON=localhost:6768 \
    npx expo start --dev-client --port 8081"
fi
wait_for 180 "Metro up" bash -c '[ "$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8081/status)" = 200 ]'

echo "5/5 install + launch"
adb install -r "$APK" | tail -1
adb shell am start -a android.intent.action.VIEW \
  -d "exp+voice-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" "$PKG" | tail -1
echo "done — screenshot with: $W/adb-shot.sh <name>"
