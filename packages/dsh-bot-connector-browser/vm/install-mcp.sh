#!/bin/sh
# Installs Playwright MCP from the package.json and npm-shrinkwrap.json in $1 into $2 (npm ci, no
# install scripts, no browser download) and swaps it in. Run as root by the browser connector's
# preparation and by infra/vm/build-base-image.sh, so both install the same tree.
set -eu
source=$1
target=$2
rm -rf -- "$target.new" "$target.old"
install -d -m 0755 -- "$target.new"
install -m 0644 -- "$source/package.json" "$source/npm-shrinkwrap.json" "$target.new/"
cd "$target.new"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
npm cache clean --force --loglevel=error
cd /
if [ -e "$target" ]; then mv -- "$target" "$target.old"; fi
mv -- "$target.new" "$target"
rm -rf -- "$target.old"
