# Shell environment for building woowtech smart (Paseo fork) on this Mac.
# Source it; it changes nothing global.
#
#   . ~/.local/share/woowtech-smart/env.sh
#
# Node: the repo pins nodejs 22.20.0 in .tool-versions. This Mac's default node
# is v24 (/usr/local/bin) and Homebrew's is v25, so put the keg-only node@22
# first. Native modules in the tree (node-pty) are ABI-bound, and
# upstream CI builds on 22 — a different major is a variable we don't need.
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

# Android: reuse the existing self-contained toolchain (JDK 21, SDK, and its own
# gradle-home) instead of the default ~/.gradle, which would duplicate ~2 GB of
# caches. Android Studio is gone from this machine, so without JAVA_HOME the
# Gradle wrapper prints a java.com hint and fails quietly.
. "$HOME/.local/share/woow-android-toolchain/env.sh"
export PATH="$ANDROID_HOME/emulator:$PATH"
