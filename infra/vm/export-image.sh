#!/usr/bin/env bash
# For the author: export the built base image for a GitHub Release.
#
# Usage: ./export-image.sh <tag> [<out dir>]     (as a user that can talk to Incus)
# Writes into <out dir> (default ./dist/<tag>): the image split into parts below
# GitHub's 2 GiB asset limit and manifest.txt, and sets IMAGE_TAG and
# IMAGE_MANIFEST_SHA256 in infra/release.env and in the plugin that imports the
# image (packages/dsh-bot-vm/src/host/image/release-env.ts). Upload them with
# publish-image.sh (infra/RELEASING.md).
#
# manifest.txt, one record per line:
#   format 1
#   dsh <DSH_VERSION>
#   image <file name> <bytes> <sha256 = Incus fingerprint>
#   part <file name> <bytes> <sha256>        (in order)
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

TAG=${1:?usage: export-image.sh <tag> [<out dir>]}
OUT=${2:-$PWD/dist/$TAG}
ALIAS=${ALIAS:-dsh-bot-base}
PART_BYTES=$((1900 * 1024 * 1024))
RELEASE_ENV=$HERE/../release.env
PLUGIN_RELEASE=$HERE/../../packages/dsh-bot-vm/src/host/image/release-env.ts

[[ $TAG =~ ^[A-Za-z0-9._-]+$ ]] || fail "Tag $TAG has characters a release tag cannot have." "Use letters, digits, dot, dash, underscore."
fp=$(alias_target "$ALIAS")
[[ -n $fp ]] || fail "There is no image alias $ALIAS." "Build it with build-base-image.sh."
version=$(incus query "/1.0/images/$fp" | sed -n 's/^[[:space:]]*"dsh.version": "\([^"]*\)".*/\1/p')
[[ $version == "$DSH_VERSION" ]] ||
  fail "$ALIAS was built for DSH ${version:-unknown}, release.env says $DSH_VERSION." "Rebuild the image with build-base-image.sh."

install -d "$OUT"
[[ -z $(ls -A "$OUT") ]] || fail "$OUT is not empty." "Give an empty or new directory."
work=$(mktemp -d "$OUT/.export.XXXXXX")
trap 'rm -rf "$work"' EXIT

log "Exporting $ALIAS ($fp)"
incus image export "$fp" "$work/"
mapfile -t exported < <(find "$work" -maxdepth 1 -type f)
((${#exported[@]} == 1)) || fail "Incus exported ${#exported[@]} files, not one unified image." "Publish the image as a unified tarball (build-base-image.sh does)."
file=${exported[0]}
[[ $(sha256sum "$file" | cut -d' ' -f1) == "$fp" ]] || fail "The exported file's sha256 is not the fingerprint $fp." "Export again."
name=dsh-bot-base-$TAG.${file##*/"$fp".}

log "Splitting into parts of at most $PART_BYTES bytes"
split -b "$PART_BYTES" -d -a 2 "$file" "$OUT/$name.part"
{
  echo "format 1"
  echo "dsh $DSH_VERSION"
  echo "image $name $(stat -c %s "$file") $fp"
  for part in "$OUT/$name".part*; do
    echo "part ${part##*/} $(stat -c %s "$part") $(sha256sum "$part" | cut -d' ' -f1)"
  done
} >"$OUT/manifest.txt"
manifest_sha=$(sha256sum "$OUT/manifest.txt" | cut -d' ' -f1)

sed -i -e "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" -e "s/^IMAGE_MANIFEST_SHA256=.*/IMAGE_MANIFEST_SHA256=$manifest_sha/" "$RELEASE_ENV"
sed -i -e "s/^export const IMAGE_TAG = .*/export const IMAGE_TAG = \"$TAG\"/" \
  -e "s/^export const MANIFEST_SHA256 = .*/export const MANIFEST_SHA256 = \"$manifest_sha\"/" "$PLUGIN_RELEASE"
log "Done"
cat "$OUT/manifest.txt"
echo
echo "release.env: IMAGE_TAG=$TAG IMAGE_MANIFEST_SHA256=$manifest_sha"
echo "Upload: infra/vm/publish-image.sh $OUT"
