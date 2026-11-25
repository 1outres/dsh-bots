#!/bin/sh
# Installs the browser's login helpers (the *.mjs files in $1) into $2 and swaps them in. Run as
# root by the browser connector's preparation and by infra/vm/build-base-image.sh.
set -eu
source=$1
target=$2
rm -rf -- "$target.new" "$target.old"
install -d -m 0755 -- "$target.new"
for file in "$source"/*.mjs; do install -m 0644 -- "$file" "$target.new/"; done
if [ -e "$target" ]; then mv -- "$target" "$target.old"; fi
mv -- "$target.new" "$target"
rm -rf -- "$target.old"
