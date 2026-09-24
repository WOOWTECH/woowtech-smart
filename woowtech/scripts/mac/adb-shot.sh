#!/bin/bash
# Screenshot the running Android emulator into a durable folder.
#
#   adb-shot.sh <name>     -> ~/.local/share/woowtech-smart/shots/<name>.png
#                              plus <name>-small.png (1000 px tall, for reading)
#
# Screenshots used to go to the session scratchpad, which is wiped when Claude
# Code restarts — the iOS verification screenshots were lost that way.
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: adb-shot.sh <name>" >&2; exit 2; }
. "$HOME/.local/share/woowtech-smart/env.sh"
dir="$HOME/.local/share/woowtech-smart/shots"
mkdir -p "$dir"
# Pin to an emulator: a Pixel 7a is paired over wireless debugging and would
# otherwise be the device an unpinned adb picks. That already happened once.
serial=${ANDROID_SERIAL:-$(adb devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1; exit}')}
case "$serial" in emulator-*) ;; *) echo "no emulator connected; refusing to screenshot '$serial'" >&2; exit 1 ;; esac
adb -s "$serial" exec-out screencap -p > "$dir/$1.png"
sips -Z 1000 "$dir/$1.png" --out "$dir/$1-small.png" >/dev/null
echo "$dir/$1-small.png"
