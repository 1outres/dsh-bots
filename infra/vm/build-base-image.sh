#!/usr/bin/env bash
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

ALIAS=${ALIAS:-dsh-bot-base}
SOURCE=${SOURCE:-images:debian/13/cloud}
PROJECT=${PROJECT:-dsh-bots}
NODE_MAJOR=${NODE_MAJOR:-24}
BOT_USER=${BOT_USER:-bot}
BUILDER=${BUILDER:-dsh-bot-base-builder}
HELPER_SHA256=${HELPER_SHA256:-8cf436d3657343765ea0031bcc6e78edb20580fb9c2595fd7bb08b193021f40e}
DESKTOP_PACKAGES_FILE=$HERE/../../packages/dsh-bot-connector-desktop/debian-packages.txt
DESKTOP_VM=$HERE/../../packages/dsh-bot-connector-desktop/vm
BROWSER_VM=$HERE/../../packages/dsh-bot-connector-browser/vm
BROWSER_MCP_DIR=/opt/dsh-browser/mcp
BROWSER_MCP_STAGE=/root/dsh-browser-mcp
BROWSER_HELPER_DIR=/opt/dsh-browser/helper
BROWSER_HELPER_STAGE=/root/dsh-browser-helper

p=(--project "$PROJECT")
cleanup() { incus delete "${p[@]}" --force "$BUILDER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

pool=$(incus project get "$PROJECT" user.dsh-bots.pool 2>/dev/null) || pool=""
network=$(incus project get "$PROJECT" user.dsh-bots.network 2>/dev/null) || network=""
[[ -n $pool && -n $network ]] || fail project-undeclared "The project $PROJECT declares no user.dsh-bots.pool / network." "Build this VM host in the dsh-bots settings (Build on this machine) or with sudo infra/vm/host-setup.sh all, or set PROJECT."
command -v zstd >/dev/null || fail tool-missing "zstd is missing (incus publish --compression zstd)." "Install zstd."
desktop_packages=$(tr '\n' ' ' <"$DESKTOP_PACKAGES_FILE")

cleanup
log "Launching builder VM from $SOURCE"
incus init -q "${p[@]}" "$SOURCE" "$BUILDER" --vm --no-profiles --storage "$pool" --network "$network" \
  -d root,size=16GiB -c limits.cpu=4 -c limits.memory=4GiB -c security.secureboot=false
incus start "${p[@]}" "$BUILDER"

log "Waiting for the incus agent"
for _ in $(seq 1 120); do
  incus exec "${p[@]}" "$BUILDER" -- true >/dev/null 2>&1 && break
  sleep 2
done
incus exec "${p[@]}" "$BUILDER" -- cloud-init status --wait >/dev/null || true

log "Copying the desktop's Chrome package source and policy, the browser's Playwright MCP shrinkwrap and login helpers"
push() { incus file push "${p[@]}" -q -p --uid 0 --gid 0 --mode "$1" "$2" "$BUILDER$3"; }
push 0644 "$DESKTOP_VM/apt/google-chrome.asc" /etc/apt/keyrings/dsh-google-chrome.asc
push 0644 "$DESKTOP_VM/apt/google-chrome.sources" /etc/apt/sources.list.d/dsh-google-chrome.sources
push 0644 "$DESKTOP_VM/config/chrome-policy.json" /etc/opt/chrome/policies/managed/dsh-desktop.json
push 0644 "$BROWSER_VM/mcp/package.json" "$BROWSER_MCP_STAGE/package.json"
push 0644 "$BROWSER_VM/mcp/npm-shrinkwrap.json" "$BROWSER_MCP_STAGE/npm-shrinkwrap.json"
push 0644 "$BROWSER_VM/install-mcp.sh" "$BROWSER_MCP_STAGE/install-mcp.sh"
for helper in "$BROWSER_VM"/helper/*.mjs; do push 0644 "$helper" "$BROWSER_HELPER_STAGE/$(basename "$helper")"; done
push 0644 "$BROWSER_VM/install-helper.sh" "$BROWSER_HELPER_STAGE/install-helper.sh"

log "Provisioning"
PROVISION=/root/dsh-provision
provision_env=$(mktemp)
{
  printf 'NODE_MAJOR="%s"\nBOT_USER="%s"\n' "$NODE_MAJOR" "$BOT_USER"
  printf 'DSH_VERSION="%s"\nHELPER_SHA256="%s"\n' "$DSH_VERSION" "$HELPER_SHA256"
  printf 'DESKTOP_PACKAGES="%s"\n' "$desktop_packages"
  printf 'BROWSER_MCP_STAGE="%s"\nBROWSER_MCP_DIR="%s"\n' "$BROWSER_MCP_STAGE" "$BROWSER_MCP_DIR"
  printf 'BROWSER_HELPER_STAGE="%s"\nBROWSER_HELPER_DIR="%s"\n' "$BROWSER_HELPER_STAGE" "$BROWSER_HELPER_DIR"
} >"$provision_env"
push 0600 "$provision_env" "$PROVISION/env"
rm -f "$provision_env"
push 0755 "$HERE/provision-base.sh" "$PROVISION/provision-base.sh"
incus exec "${p[@]}" "$BUILDER" -- systemd-run --unit=dsh-provision --collect --setenv=HOME=/root \
  --property=EnvironmentFile="$PROVISION/env" \
  sh -c "bash $PROVISION/provision-base.sh >$PROVISION/log 2>&1; echo \$? >$PROVISION/status"
until status=$(incus exec "${p[@]}" "$BUILDER" -- cat "$PROVISION/status" 2>/dev/null); do sleep 15; done
incus file pull "${p[@]}" "$BUILDER$PROVISION/log" - || true
[[ $status == 0 ]] || { echo "provisioning failed (exit $status)" >&2; exit 1; }
incus exec "${p[@]}" "$BUILDER" -- rm -rf "$PROVISION"

log "Stopping builder"
incus stop "${p[@]}" "$BUILDER"

old_fp=$(alias_target "$PROJECT" "$ALIAS")

log "Publishing image"
published=$(incus publish "${p[@]}" "$BUILDER" --compression zstd \
  os=Debian release=trixie variant=dsh-bot \
  dsh.version="$DSH_VERSION" \
  description="dsh bot base: Debian 13, node ${NODE_MAJOR}.x, dsh-ssh ${DSH_VERSION}, user ${BOT_USER}, desktop packages, Google Chrome, Playwright MCP (built $(date -u +%Y-%m-%dT%H:%MZ))")
new_fp=$(awk '/fingerprint:/ {print $NF}' <<<"$published")
[[ $new_fp =~ ^[0-9a-f]{64}$ ]] || { echo "no fingerprint in: $published" >&2; exit 1; }

if [[ -n $old_fp ]]; then
  log "Pointing $ALIAS at $new_fp"
  incus query -X PATCH "/1.0/images/aliases/$ALIAS?project=$PROJECT" --data "{\"target\": \"$new_fp\"}" >/dev/null
else
  log "Creating alias $ALIAS"
  incus image alias create "${p[@]}" "$ALIAS" "$new_fp"
fi

if [[ -n $old_fp && $old_fp != "$new_fp" ]]; then
  old_aliases=$(aliases_of "$PROJECT" "$old_fp")
  if [[ -z $old_aliases ]]; then
    log "Deleting previous image $old_fp"
    incus image delete "${p[@]}" "$old_fp"
  else
    log "Keeping previous image $old_fp (aliases: $(tr '\n' ' ' <<<"$old_aliases"))"
  fi
fi

incus image list "${p[@]}" "$ALIAS"
