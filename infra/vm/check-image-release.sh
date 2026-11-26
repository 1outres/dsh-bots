#!/usr/bin/env bash
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

command -v gh >/dev/null || fail "gh (GitHub CLI) is not installed." "Install it: https://cli.github.com/"
[[ -n $IMAGE_TAG && -n $IMAGE_MANIFEST_SHA256 ]] ||
  fail "infra/release.env names no base image (IMAGE_TAG, IMAGE_MANIFEST_SHA256)." "Export one with export-image.sh, publish it with publish-image.sh, and merge release.env."

draft=$(gh release view "$IMAGE_TAG" --json isDraft --jq .isDraft 2>/dev/null) ||
  fail "There is no GitHub release $IMAGE_TAG." "Publish the image with infra/vm/publish-image.sh."
[[ $draft == false ]] || fail "The release $IMAGE_TAG is still a draft." "Run infra/vm/publish-image.sh again to finish it."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gh release download "$IMAGE_TAG" --pattern manifest.txt --dir "$work" ||
  fail "The release $IMAGE_TAG has no manifest.txt." "Publish the image with infra/vm/publish-image.sh."
manifest=$work/manifest.txt
actual=$(sha256sum "$manifest" | cut -d' ' -f1)
[[ $actual == "$IMAGE_MANIFEST_SHA256" ]] ||
  fail "The manifest.txt of $IMAGE_TAG has sha256 $actual, release.env names $IMAGE_MANIFEST_SHA256." "Set release.env to the image that is published (export-image.sh writes both), or publish that image."
dsh=$(awk '$1 == "dsh" {print $2}' "$manifest")
[[ $dsh == "$DSH_VERSION" ]] || fail "The image of $IMAGE_TAG is for DSH $dsh, release.env names $DSH_VERSION." "Build and publish an image for DSH $DSH_VERSION."

gh release view "$IMAGE_TAG" --json assets --jq '.assets[] | "\(.name) \(.size)"' >"$work/assets"
missing=()
while read -r _ part size _; do
  grep -qxF "$part $size" "$work/assets" || missing+=("$part")
done < <(awk '$1 == "part"' "$manifest")
((${#missing[@]} == 0)) || fail "The release $IMAGE_TAG lacks these parts or has them with another size: ${missing[*]}." "Run infra/vm/publish-image.sh again to upload them."

note "$IMAGE_TAG: manifest $IMAGE_MANIFEST_SHA256, DSH $dsh, $(awk '$1 == "part"' "$manifest" | wc -l) parts"
