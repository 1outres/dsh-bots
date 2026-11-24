#!/usr/bin/env bash
# Build (or rebuild) the dsh bot base VM image and publish it as an Incus
# image alias. Idempotent: the alias is moved to the new image and the
# previous image is deleted, unless another alias still names it.
#
# Usage: ./build-base-image.sh     (as a user that can talk to Incus)
# Tunables: ALIAS (dsh-bot-base), SOURCE (images:debian/13/cloud),
#           PROFILE (dsh-bot), NODE_MAJOR (24), BOT_USER (bot),
#           HELPER_SHA256 (expected sha256 of dsh-ssh lib/helper.js; build fails on mismatch)
# The dsh-ssh helper is the DSH_VERSION of infra/release.env.
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

ALIAS=${ALIAS:-dsh-bot-base}
SOURCE=${SOURCE:-images:debian/13/cloud}
PROFILE=${PROFILE:-dsh-bot}
NODE_MAJOR=${NODE_MAJOR:-24}
BOT_USER=${BOT_USER:-bot}
BUILDER=${BUILDER:-dsh-bot-base-builder}
HELPER_SHA256=${HELPER_SHA256:-8cf436d3657343765ea0031bcc6e78edb20580fb9c2595fd7bb08b193021f40e}
DESKTOP_PACKAGES_FILE=$HERE/../../packages/dsh-bot-connector-desktop/debian-packages.txt
DESKTOP_VM=$HERE/../../packages/dsh-bot-connector-desktop/vm
BROWSER_VM=$HERE/../../packages/dsh-bot-connector-browser/vm
BROWSER_MCP_DIR=/opt/dsh-browser/mcp
BROWSER_MCP_STAGE=/root/dsh-browser-mcp

cleanup() { incus delete --force "$BUILDER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

incus profile show "$PROFILE" >/dev/null 2>&1 || fail "There is no Incus profile $PROFILE." "Run host-setup.sh first."
command -v zstd >/dev/null || fail "zstd is missing (incus publish --compression zstd)." "Install zstd."
desktop_packages=$(tr '\n' ' ' <"$DESKTOP_PACKAGES_FILE")

cleanup
log "Launching builder VM from $SOURCE"
incus launch -q "$SOURCE" "$BUILDER" --vm -p "$PROFILE"

log "Waiting for the incus agent"
for _ in $(seq 1 120); do
  incus exec "$BUILDER" -- true >/dev/null 2>&1 && break
  sleep 2
done
incus exec "$BUILDER" -- cloud-init status --wait >/dev/null || true

log "Copying the desktop's Chrome package source and the browser's Playwright MCP shrinkwrap"
push() { incus file push -q -p --uid 0 --gid 0 --mode "$1" "$2" "$BUILDER$3"; }
push 0644 "$DESKTOP_VM/apt/google-chrome.asc" /etc/apt/keyrings/dsh-google-chrome.asc
push 0644 "$DESKTOP_VM/apt/google-chrome.sources" /etc/apt/sources.list.d/dsh-google-chrome.sources
push 0644 "$BROWSER_VM/mcp/package.json" "$BROWSER_MCP_STAGE/package.json"
push 0644 "$BROWSER_VM/mcp/npm-shrinkwrap.json" "$BROWSER_MCP_STAGE/npm-shrinkwrap.json"
push 0644 "$BROWSER_VM/install-mcp.sh" "$BROWSER_MCP_STAGE/install-mcp.sh"

# Provisioning runs detached in the builder (a transient unit) and is polled with
# short execs: one long incus exec stream dies when the host is busy.
log "Provisioning"
PROVISION=/root/dsh-provision
provision_env=$(mktemp)
{
  printf 'NODE_MAJOR="%s"\nBOT_USER="%s"\n' "$NODE_MAJOR" "$BOT_USER"
  printf 'DSH_VERSION="%s"\nHELPER_SHA256="%s"\n' "$DSH_VERSION" "$HELPER_SHA256"
  printf 'DESKTOP_PACKAGES="%s"\n' "$desktop_packages"
  printf 'BROWSER_MCP_STAGE="%s"\nBROWSER_MCP_DIR="%s"\n' "$BROWSER_MCP_STAGE" "$BROWSER_MCP_DIR"
} >"$provision_env"
push 0600 "$provision_env" "$PROVISION/env"
rm -f "$provision_env"
push 0755 "$HERE/provision-base.sh" "$PROVISION/provision-base.sh"
incus exec "$BUILDER" -- systemd-run --unit=dsh-provision --collect --setenv=HOME=/root \
  --property=EnvironmentFile="$PROVISION/env" \
  sh -c "bash $PROVISION/provision-base.sh >$PROVISION/log 2>&1; echo \$? >$PROVISION/status"
until status=$(incus exec "$BUILDER" -- cat "$PROVISION/status" 2>/dev/null); do sleep 15; done
incus file pull "$BUILDER$PROVISION/log" - || true
[[ $status == 0 ]] || { echo "provisioning failed (exit $status)" >&2; exit 1; }
incus exec "$BUILDER" -- rm -rf "$PROVISION"

log "Stopping builder"
incus stop "$BUILDER"

old_fp=$(alias_target "$ALIAS")

log "Publishing image"
published=$(incus publish "$BUILDER" --compression zstd \
  os=Debian release=trixie variant=dsh-bot \
  dsh.version="$DSH_VERSION" \
  description="dsh bot base: Debian 13, node ${NODE_MAJOR}.x, dsh-ssh ${DSH_VERSION}, user ${BOT_USER}, desktop packages, Google Chrome, Playwright MCP (built $(date -u +%Y-%m-%dT%H:%MZ))")
new_fp=$(awk '/fingerprint:/ {print $NF}' <<<"$published")
[[ $new_fp =~ ^[0-9a-f]{64}$ ]] || { echo "no fingerprint in: $published" >&2; exit 1; }

# One update of the alias's target: VMs created meanwhile get the old or the new image, never none.
if [[ -n $old_fp ]]; then
  log "Pointing $ALIAS at $new_fp"
  incus query -X PATCH "/1.0/images/aliases/$ALIAS" --data "{\"target\": \"$new_fp\"}" >/dev/null
else
  log "Creating alias $ALIAS"
  incus image alias create "$ALIAS" "$new_fp"
fi

if [[ -n $old_fp && $old_fp != "$new_fp" ]]; then
  old_aliases=$(aliases_of "$old_fp")
  if [[ -z $old_aliases ]]; then
    log "Deleting previous image $old_fp"
    incus image delete "$old_fp"
  else
    log "Keeping previous image $old_fp (aliases: $(tr '\n' ' ' <<<"$old_aliases"))"
  fi
fi

incus image list "$ALIAS"
