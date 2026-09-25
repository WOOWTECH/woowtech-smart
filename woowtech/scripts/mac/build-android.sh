#!/bin/bash
# Build the woowtech smart (Paseo fork) Android debug APK on this Mac.
#
#   ~/.local/share/woowtech-smart/build-android.sh                    # arm64-v8a
#   ~/.local/share/woowtech-smart/build-android.sh x86_64             # other ABI
#   ~/.local/share/woowtech-smart/build-android.sh x86_64 --offline   # more gradlew arguments
#   ~/.local/share/woowtech-smart/build-android.sh --offline          # ... with the default ABI
#
#   WOOW_GRADLE_USER_HOME=/Volumes/WOOW-BUILD/woowtech-smart/gradle-home \
#     ~/.local/share/woowtech-smart/build-android.sh                  # Gradle home on another disk
#   WOOW_DRY_RUN=1 ~/.local/share/woowtech-smart/build-android.sh      # print the settings, build nothing
#
# Run `APP_VARIANT=development npx expo prebuild --platform android` in
# packages/app first; android/ is generated and gitignored.
#
# WHY EACH FLAG
# -------------
# org.gradle.java.installations.paths / auto-download=false
#   React Native's Gradle plugin declares `jvmToolchain(17)`. The shared
#   toolchain only ships JDK 21, and Gradle discovers macOS JDKs through
#   /usr/libexec/java_home — which does not see Homebrew's keg-only openjdk@17.
#   So Gradle fell back to the foojay resolver and started downloading Temurin
#   17 from GitHub release assets, which crawl on this network. On 2026-09-23
#   that turned into a 9-hour silent hang in the configuration phase with no
#   error. Pointing Gradle at the local JDK 17 fixes it; disabling
#   auto-download turns any future toolchain miss into an immediate error
#   instead of another silent download.
#
# reactNativeArchitectures=<one ABI>
#   Upstream builds four ABIs, i.e. every native module is compiled four times.
#   An Apple-silicon emulator only needs arm64-v8a.
#
# JVM heap / max-workers
#   This Mac has 8 GB of RAM and swap is routinely near full. Expo's generated
#   gradle.properties asks for -Xmx4096m for the daemon alone; the Kotlin
#   daemon is a second JVM on top of that.
#
# WOOW_GRADLE_USER_HOME
#   env.sh points GRADLE_USER_HOME at the shared toolchain's gradle-home on the
#   internal disk. A cold build writes about 3.7 GB of transforms into it, and on
#   2026-09-25 that filled the internal disk mid-build. With this set, Gradle
#   keeps its caches there instead and reads the dependencies it already
#   downloaded from the shared home's caches (GRADLE_RO_DEP_CACHE), so they are
#   not downloaded again. Gradle reads that cache without locking it, so do not
#   run another build on the shared home at the same time. A GRADLE_RO_DEP_CACHE
#   set by the caller wins. The Gradle distribution itself is not a dependency:
#   copy wrapper/dists over from the shared home once, or gradlew downloads it.
set -euo pipefail

# The first argument is the ABI unless it is already a Gradle option.
ABI=arm64-v8a
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
  ABI=${1:-arm64-v8a}
  shift
fi
JDK17=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
ANDROID_DIR="$HOME/projects/woowtech-smart/packages/app/android"

. "$HOME/.local/share/woowtech-smart/env.sh"
[ -x "$JDK17/bin/java" ] || { echo "JDK 17 missing at $JDK17 (brew install openjdk@17)" >&2; exit 1; }

SHARED_GRADLE_USER_HOME=${GRADLE_USER_HOME:-}
if [ -n "${WOOW_GRADLE_USER_HOME:-}" ] && [ "$WOOW_GRADLE_USER_HOME" != "$SHARED_GRADLE_USER_HOME" ]; then
  # Refuse a relative path, and a folder whose drive is not mounted.
  case "$WOOW_GRADLE_USER_HOME" in
    /*) ;;
    *) echo "WOOW_GRADLE_USER_HOME must be an absolute path: $WOOW_GRADLE_USER_HOME" >&2; exit 1 ;;
  esac
  parent=$(dirname "$WOOW_GRADLE_USER_HOME")
  [ -d "$parent" ] || { echo "WOOW_GRADLE_USER_HOME: $parent does not exist (is the drive mounted?)" >&2; exit 1; }
  if [ -n "$SHARED_GRADLE_USER_HOME" ]; then
    export GRADLE_RO_DEP_CACHE="${GRADLE_RO_DEP_CACHE:-$SHARED_GRADLE_USER_HOME/caches}"
  fi
  export GRADLE_USER_HOME="$WOOW_GRADLE_USER_HOME"
fi

GRADLE_ARGS=(
  :app:assembleDebug
  --console=plain
  -Porg.gradle.java.installations.paths="$JDK17"
  -Porg.gradle.java.installations.auto-download=false
  -PreactNativeArchitectures="$ABI"
  -Pkotlin.daemon.jvmargs=-Xmx1536m
  "-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m"
  --max-workers=4
  "$@"
)

if [ -n "${WOOW_DRY_RUN:-}" ]; then
  echo "ABI=$ABI"
  echo "JAVA_HOME=${JAVA_HOME:-}"
  echo "GRADLE_USER_HOME=${GRADLE_USER_HOME:-}"
  echo "GRADLE_RO_DEP_CACHE=${GRADLE_RO_DEP_CACHE:-}"
  echo "cd $ANDROID_DIR"
  printf './gradlew'
  printf ' %q' "${GRADLE_ARGS[@]}"
  printf '\n'
  exit 0
fi

cd "$ANDROID_DIR"
exec ./gradlew "${GRADLE_ARGS[@]}"
