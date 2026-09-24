#!/bin/bash
# Build the woowtech smart (Paseo fork) Android debug APK on this Mac.
#
#   ~/.local/share/woowtech-smart/build-android.sh            # arm64-v8a
#   ~/.local/share/woowtech-smart/build-android.sh x86_64     # other ABI
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
set -euo pipefail

ABI="${1:-arm64-v8a}"
JDK17=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home

. "$HOME/.local/share/woowtech-smart/env.sh"
[ -x "$JDK17/bin/java" ] || { echo "JDK 17 missing at $JDK17 (brew install openjdk@17)" >&2; exit 1; }

cd "$HOME/projects/woowtech-smart/packages/app/android"
exec ./gradlew :app:assembleDebug \
  --console=plain \
  -Porg.gradle.java.installations.paths="$JDK17" \
  -Porg.gradle.java.installations.auto-download=false \
  -PreactNativeArchitectures="$ABI" \
  -Pkotlin.daemon.jvmargs=-Xmx1536m \
  "-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m" \
  --max-workers=4
