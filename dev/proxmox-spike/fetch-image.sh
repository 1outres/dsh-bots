#!/usr/bin/env bash
set -euo pipefail
DIR=${1:?dir}
. "$(dirname "$0")/../../infra/release.env"
BASE=https://github.com/1outres/dsh-bots/releases/download/$IMAGE_TAG
mkdir -p "$DIR"; cd "$DIR"
curl -fsSL -o manifest.txt "$BASE/manifest.txt"
echo "$IMAGE_MANIFEST_SHA256  manifest.txt" | sha256sum -c --quiet
awk '$1=="part"{print $2, $3, $4}' manifest.txt | while read -r name _ sha; do
  [ -f "$name" ] || curl -fsSL -o "$name" "$BASE/$name"
  echo "$sha  $name" | sha256sum -c --quiet
done
read -r _ image _ sha < <(awk '$1=="image"' manifest.txt)
mapfile -t parts < <(awk '$1=="part"{print $2}' manifest.txt)
cat "${parts[@]}" >"$image"
echo "$sha  $image" | sha256sum -c --quiet
echo "ok $image"
