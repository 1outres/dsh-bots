#!/usr/bin/env bash
# Start a throw-away VM the way dsh-bot-vm starts a bot's and check what a bot
# needs: sshd answers over vsock (socat), HTTPS reaches the internet, and the
# shared workspace maps the guest's bot to DSH_USER. Root (install.sh runs it with sudo).
# The first VM from a new image waits for Incus to unpack it (minutes, once).
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

[[ -n ${DSH_USER:-} ]] || fail "DSH_USER is not set." "Set DSH_USER to the user that runs DSH."
NAME=dsh-bots-install-check
IMAGE=${IMAGE:-dsh-bot-base}
PROFILE=${PROFILE:-dsh-bot}
GUEST_UID=1001
DSH_HOME=$(getent passwd "$DSH_USER" | cut -d: -f6)
BOTS_ROOT=${BOTS_ROOT:-$DSH_HOME/.dsh/bots}
SHARE=$BOTS_ROOT/.install-check
uid=$(id -u "$DSH_USER")
gid=$(id -g "$DSH_USER")

cleanup() {
  incus delete --force "$NAME" >/dev/null 2>&1 || true
  rm -rf "$SHARE"
}
trap cleanup EXIT
cleanup

runuser -u "$DSH_USER" -- install -d -m 0755 "$SHARE"
log "Creating $NAME"
incus init -q "$IMAGE" "$NAME" --vm -p "$PROFILE" -c limits.cpu=2 -c limits.memory=2GiB -c boot.autostart=false \
  -c raw.idmap="$(printf 'uid %s %s\ngid %s %s' "$uid" "$GUEST_UID" "$gid" "$GUEST_UID")"
incus config device add -q "$NAME" workspace disk source="$SHARE" path=/home/bot/workspace io.bus=virtiofs
incus start "$NAME" || fail "The test VM did not start." "See the log; incus info --show-log $NAME shows QEMU's output."

wait_for() { # wait_for <seconds> <command...>
  local deadline=$((SECONDS + $1))
  shift
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || return 1
    sleep 3
  done
}
banner() {
  local cid
  cid=$(incus config get "$NAME" volatile.vsock_id)
  [[ $(timeout 10 socat -T5 STDIO "VSOCK-CONNECT:$cid:22" </dev/null 2>/dev/null | head -c 8) == SSH-2.0- ]]
}

log "Waiting for sshd over vsock"
wait_for 600 banner ||
  fail "The test VM's sshd did not answer over vsock within 10 minutes." "Check that vhost_vsock is loaded (lsmod) and see the log."
wait_for 120 incus exec "$NAME" -- test -e /var/lib/cloud/instance/boot-finished ||
  fail "The test VM did not finish booting." "See the log."

log "Checking the network"
code=$(incus exec "$NAME" -- curl -sS -m 20 -o /dev/null -w '%{http_code}' https://deb.debian.org/ 2>&1) ||
  fail "The test VM cannot reach the internet ($code)." \
    "A firewall drops forwarding for dshbr0 (iptables-legacy rules are not visible to nft); allow dshbr0 there."

log "Checking the shared workspace"
incus exec "$NAME" -- su bot -c 'touch /home/bot/workspace/check' ||
  fail "The bot user cannot write the shared workspace." "See the log (virtiofsd, raw.idmap)."
[[ $(stat -c %u "$SHARE/check") == "$uid" ]] ||
  fail "A file the bot wrote is not owned by $DSH_USER on the Host." "See the log (raw.idmap)."
note "ssh over vsock, internet, shared workspace"
