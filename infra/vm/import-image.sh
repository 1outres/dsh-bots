#!/usr/bin/env bash
# Import a verified base image file and point the alias at it. Root (install.sh runs it with sudo).
# Usage: import-image.sh <file> <fingerprint>
# The alias moves in one update (a VM created meanwhile gets the old or the new
# image); the previous image is deleted unless another alias names it.
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

FILE=${1:?usage: import-image.sh <file> <fingerprint>}
FP=${2:?usage: import-image.sh <file> <fingerprint>}
ALIAS=${ALIAS:-dsh-bot-base}

old=$(alias_target "$ALIAS")
if [[ $old == "$FP" ]]; then
  note "already imported"
  exit 0
fi
if ! incus query "/1.0/images/$FP" >/dev/null 2>&1; then
  incus image import "$FILE"
fi
incus query "/1.0/images/$FP" >/dev/null 2>&1 || fail "Incus did not import the image $FP." "See the log for incus image import."
if [[ -n $old ]]; then
  incus query -X PATCH "/1.0/images/aliases/$ALIAS" --data "{\"target\": \"$FP\"}" >/dev/null
  if [[ -z $(aliases_of "$old") ]]; then incus image delete "$old"; fi
  note "replaced the previous image"
else
  incus image alias create "$ALIAS" "$FP"
fi
