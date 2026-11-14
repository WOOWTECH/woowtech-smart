#!/bin/bash
# woowtech-notarize-dmg.sh: sign, notarize and staple the outer DMG container of an already signed,
# notarized and stapled desktop build, so a downloaded DMG also passes Gatekeeper's "open" check.
#
# electron-builder notarizes and staples the .app; the DMG it writes around the app is left unsigned
# (`spctl -a -t open` rejects it: "no usable signature"; no ticket). This script works on a COPY:
#   1. copy the input DMG to --out (refuses to overwrite) and record the app's cdhash inside it
#   2. codesign the copy with the Developer ID Application identity and a secure timestamp
#   3. notarytool submit --wait; anything but Accepted fails (the notary log is saved next to --out)
#   4. stapler staple, then verify: codesign --verify --strict, spctl -a -t open
#      --context context:primary-signature, stapler validate, and the app inside still has the same cdhash
#      and is still accepted and stapled
# The app is never re-signed. Secrets are only read from the files named; nothing is printed.
#
#   woowtech-notarize-dmg.sh --dmg <in.dmg> --out <out.dmg> --app "<App Name>" \
#     --identity "Developer ID Application: Name (TEAMID)" [--keychain <path>] \
#     --notary-key <AuthKey.p8> --notary-key-id <id> --notary-issuer <uuid>
set -euo pipefail
die() { echo "woowtech-notarize-dmg: ERROR: $*" >&2; exit 1; }
say() { echo "woowtech-notarize-dmg: $*"; }

IN="" OUT="" APP="" IDENT="" KEYCHAIN="" NKEY="" NKID="" NISS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dmg) IN=${2:-}; shift 2 ;;
    --out) OUT=${2:-}; shift 2 ;;
    --app) APP=${2:-}; shift 2 ;;
    --identity) IDENT=${2:-}; shift 2 ;;
    --keychain) KEYCHAIN=${2:-}; shift 2 ;;
    --notary-key) NKEY=${2:-}; shift 2 ;;
    --notary-key-id) NKID=${2:-}; shift 2 ;;
    --notary-issuer) NISS=${2:-}; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ "$(uname -s)" = Darwin ] || die "needs macOS"
[ -f "$IN" ] || die "no input DMG: $IN"
[ -n "$OUT" ] && [ ! -e "$OUT" ] || die "--out must be a new path"
[ -n "$APP" ] || die "--app is required"
case "$IDENT" in 'Developer ID Application: '*) ;; *) die "--identity must be a Developer ID Application identity" ;; esac
[ -f "$NKEY" ] && [ -n "$NKID" ] && [ -n "$NISS" ] || die "--notary-key, --notary-key-id and --notary-issuer are required"
[ -z "$KEYCHAIN" ] || [ -f "$KEYCHAIN" ] || die "no such keychain: $KEYCHAIN"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/notarize-dmg.XXXXXX"); MNT=""
ORIG_LIST=()
restore() {
  [ -n "$MNT" ] && hdiutil detach "$MNT" -force -quiet 2>/dev/null || true
  if [ "${#ORIG_LIST[@]}" -gt 0 ]; then security list-keychains -d user -s "${ORIG_LIST[@]}" || true; fi
  rm -rf "${WORK:?}"
}
trap restore EXIT

# check_app <dmg>: sets APP_CDHASH to the cdhash of the app inside and checks the app is intact, accepted and
# stapled. Called directly, never in $(...): MNT must stay visible to the EXIT trap so a failure unmounts.
APP_CDHASH=""
check_app() {
  APP_CDHASH=""
  MNT="$WORK/mnt"; mkdir -p "$MNT"
  hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$MNT" "$1" >/dev/null
  local app="$MNT/$APP.app" cd
  [ -d "$app" ] || die "no $APP.app in $1"
  codesign --verify --deep --strict "$app" 2>/dev/null || die "codesign --verify --deep --strict fails for the app inside $1"
  cd=$(codesign -dvvv "$app" 2>&1 | sed -n 's/^CDHash=//p')
  [[ "$cd" =~ ^[0-9a-f]{40}$ ]] || die "no valid CDHash for the app inside $1"
  spctl -a -t exec "$app" 2>/dev/null || die "the app inside $1 is not accepted by Gatekeeper"
  xcrun stapler validate "$app" >/dev/null 2>&1 || die "the app inside $1 has no stapled ticket"
  hdiutil detach "$MNT" -quiet; MNT=""
  APP_CDHASH=$cd
}

check_app "$IN"; BEFORE=$APP_CDHASH
say "app cdhash in the input DMG: $BEFORE (verified --deep --strict, accepted, stapled)"
mkdir -p "$(dirname "$OUT")"
cp "$IN" "$OUT"

KC_ARGS=()
if [ -n "$KEYCHAIN" ]; then
  # codesign finds an identity in another keychain only when it is on the search list.
  while IFS= read -r k; do k=${k#*\"}; ORIG_LIST+=("${k%\"*}"); done < <(security list-keychains -d user)
  security list-keychains -d user -s "$KEYCHAIN" "${ORIG_LIST[@]}"
  KC_ARGS=(--keychain "$KEYCHAIN")
fi
codesign --sign "$IDENT" ${KC_ARGS[@]+"${KC_ARGS[@]}"} --timestamp "$OUT"
say "signed $(basename "$OUT")"

say "notarizing (this waits for Apple)"
SUB="$WORK/submit.json"
xcrun notarytool submit "$OUT" --key "$NKEY" --key-id "$NKID" --issuer "$NISS" --wait --output-format json > "$SUB" || true
ID=$(/usr/bin/python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$SUB" 2>/dev/null || true)
STATUS=$(/usr/bin/python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$SUB" 2>/dev/null || true)
[ -n "$ID" ] && xcrun notarytool log "$ID" --key "$NKEY" --key-id "$NKID" --issuer "$NISS" "$OUT.notary-log.json" >/dev/null 2>&1 || true
[ "$STATUS" = Accepted ] || die "notarization status: ${STATUS:-none} (submission ${ID:-none}); log: $OUT.notary-log.json"
say "notarization Accepted (submission $ID)"

xcrun stapler staple "$OUT" >/dev/null
codesign --verify --strict --verbose=2 "$OUT" 2>&1 | sed 's/^/  /'
codesign -dvv "$OUT" 2>&1 | grep -E '^(Authority|TeamIdentifier|Timestamp)=' | head -4 | sed 's/^/  /'
spctl -a -t open --context context:primary-signature -vv "$OUT" 2>&1 | sed 's/^/  /'
spctl -a -t open --context context:primary-signature "$OUT" 2>/dev/null || die "spctl -t open rejects the signed DMG"
xcrun stapler validate "$OUT" >/dev/null 2>&1 || die "no stapled ticket on the DMG"
say "stapler validate: ok"
check_app "$OUT"; AFTER=$APP_CDHASH
[ "$AFTER" = "$BEFORE" ] || die "the app's cdhash changed ($BEFORE -> $AFTER)"
say "app inside unchanged (cdhash $AFTER, verified --deep --strict, accepted, stapled)"
shasum -a 256 "$OUT" | awk -v n="$(basename "$OUT")" '{print $1"  "n}' > "$OUT.sha256"
say "OK $(basename "$OUT") $(stat -f%z "$OUT") bytes sha256 $(cut -c1-64 "$OUT.sha256") submission $ID"
