#!/bin/sh
set -eu
source=$1
target=$2
rm -rf -- "$target.new" "$target.old"
install -d -m 0755 -- "$target.new"
for file in "$source"/*.mjs; do install -m 0644 -- "$file" "$target.new/"; done
if [ -e "$target" ]; then mv -- "$target" "$target.old"; fi
mv -- "$target.new" "$target"
rm -rf -- "$target.old"
