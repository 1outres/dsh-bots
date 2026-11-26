#!/usr/bin/env bash
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

command -v gh >/dev/null || fail tool-missing "gh (GitHub CLI) is not installed." "Install it: https://cli.github.com/"
gh auth status >/dev/null 2>&1 || fail tool-missing "gh is not signed in to GitHub." "Run gh auth login."
[[ -n $IMAGE_TAG && -n $IMAGE_MANIFEST_SHA256 ]] ||
  fail release-mismatch "infra/release.env names no base image." "Export one first: infra/vm/export-image.sh image-YYYYMMDD."
[[ $IMAGE_TAG == image-* ]] || fail release-mismatch "IMAGE_TAG is $IMAGE_TAG; base image releases are named image-<name>." "Export again with a tag like image-YYYYMMDD."

DIR=${1:-$PWD/dist/$IMAGE_TAG}
manifest=$DIR/manifest.txt
[[ -f $manifest ]] || fail release-mismatch "$manifest does not exist." "Give the directory export-image.sh wrote."
[[ $(sha256sum "$manifest" | cut -d' ' -f1) == "$IMAGE_MANIFEST_SHA256" ]] ||
  fail release-mismatch "$manifest is not the manifest release.env names." "Give the directory of the export that wrote release.env, or export again."

log "Checking the parts in $DIR"
files=("$manifest")
while read -r _ part size sha; do
  [[ -f $DIR/$part && $(stat -c %s "$DIR/$part") == "$size" ]] || fail release-mismatch "$DIR/$part is missing or not $size bytes." "Export again."
  [[ $(sha256sum "$DIR/$part" | cut -d' ' -f1) == "$sha" ]] || fail release-mismatch "$DIR/$part does not have the sha256 the manifest names." "Export again."
  files+=("$DIR/$part")
done < <(awk '$1 == "part"' "$manifest")

if draft=$(gh release view "$IMAGE_TAG" --json isDraft --jq .isDraft 2>/dev/null); then
  if [[ $draft == false ]]; then
    log "$IMAGE_TAG is already published"
    exec bash "$HERE/check-image-release.sh"
  fi
  log "Finishing the draft release $IMAGE_TAG"
else
  log "Creating the draft release $IMAGE_TAG"
  commit=$(git -C "$HERE" rev-parse --verify HEAD)
  gh release create "$IMAGE_TAG" --draft --latest=false --title "Base image $IMAGE_TAG" \
    --notes "dsh-bots base image for DSH $DSH_VERSION, built from commit $commit. Not a dsh-bots release: install.sh downloads it for the release whose infra/release.env names $IMAGE_TAG."
fi
log "Uploading ${#files[@]} files"
gh release upload "$IMAGE_TAG" "${files[@]}" --clobber
gh release edit "$IMAGE_TAG" --draft=false --latest=false
log "Published $IMAGE_TAG"
bash "$HERE/check-image-release.sh"
echo "Next: commit infra/release.env (IMAGE_TAG=$IMAGE_TAG) and merge it to main (infra/RELEASING.md)."
