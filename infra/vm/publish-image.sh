#!/usr/bin/env bash
# For the author: publish the base image that export-image.sh exported as the GitHub
# release IMAGE_TAG (infra/release.env), then check it with check-image-release.sh.
# Safe to run again: it finishes a draft that an interrupted upload left.
#
# Usage: ./publish-image.sh [<dir>]     (default ./dist/<IMAGE_TAG>, export-image.sh's output; gh signed in)
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

command -v gh >/dev/null || fail "gh (GitHub CLI) is not installed." "Install it: https://cli.github.com/"
gh auth status >/dev/null 2>&1 || fail "gh is not signed in to GitHub." "Run gh auth login."
[[ -n $IMAGE_TAG && -n $IMAGE_MANIFEST_SHA256 ]] ||
  fail "infra/release.env names no base image." "Export one first: infra/vm/export-image.sh image-YYYYMMDD."
[[ $IMAGE_TAG == image-* ]] || fail "IMAGE_TAG is $IMAGE_TAG; base image releases are named image-<name>." "Export again with a tag like image-YYYYMMDD."

DIR=${1:-$PWD/dist/$IMAGE_TAG}
manifest=$DIR/manifest.txt
[[ -f $manifest ]] || fail "$manifest does not exist." "Give the directory export-image.sh wrote."
[[ $(sha256sum "$manifest" | cut -d' ' -f1) == "$IMAGE_MANIFEST_SHA256" ]] ||
  fail "$manifest is not the manifest release.env names." "Give the directory of the export that wrote release.env, or export again."

log "Checking the parts in $DIR"
files=("$manifest")
while read -r _ part size sha; do
  [[ -f $DIR/$part && $(stat -c %s "$DIR/$part") == "$size" ]] || fail "$DIR/$part is missing or not $size bytes." "Export again."
  [[ $(sha256sum "$DIR/$part" | cut -d' ' -f1) == "$sha" ]] || fail "$DIR/$part does not have the sha256 the manifest names." "Export again."
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
