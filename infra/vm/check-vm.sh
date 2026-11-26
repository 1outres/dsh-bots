#!/usr/bin/env bash
# Check a VM host the way dsh-bot-vm uses it: start a throw-away VM in the project
# from its base image, on the pool and network the project declares, and check that
# Incus' exec reaches it, that HTTPS reaches the internet and that the gateway does
# not answer. Run it on the VM host as a user in incus-admin (or root), after the
# dsh-bots settings imported the base image. The first VM from a new image waits for
# Incus to unpack it (minutes, once).
#
# Environment: PROJECT (dsh-bots), IMAGE (dsh-bot-base)
set -eEuo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

PROJECT=${PROJECT:-dsh-bots}
IMAGE=${IMAGE:-dsh-bot-base}
NAME=dsh-bots-host-check
p=(--project "$PROJECT")

pool=$(incus project get "$PROJECT" user.dsh-bots.pool) ||
  fail "There is no project $PROJECT." "Prepare this VM host with install.sh first."
network=$(incus project get "$PROJECT" user.dsh-bots.network)
[[ -n $pool && -n $network ]] || fail "The project $PROJECT declares no user.dsh-bots.pool / network." "Run install.sh again."
[[ -n $(alias_target "$PROJECT" "$IMAGE") ]] ||
  fail "The project $PROJECT has no image $IMAGE yet." "Import it in DSH: dsh-bots settings → VM host → Base image."

cleanup() { incus delete "${p[@]}" --force "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

log "Creating $NAME"
incus init -q "${p[@]}" "$IMAGE" "$NAME" --vm --no-profiles --storage "$pool" --network "$network" \
  -c limits.cpu=2 -c limits.memory=2GiB -c security.guestapi=false -c security.secureboot=false -c boot.autostart=false
incus config device set "${p[@]}" "$NAME" root size=16GiB
incus config device set "${p[@]}" "$NAME" eth0 \
  security.port_isolation=true security.mac_filtering=true security.ipv4_filtering=true
incus start "${p[@]}" "$NAME" || fail "The test VM did not start." "See the log; incus info --show-log $NAME --project $PROJECT shows QEMU's output."

wait_for() { # wait_for <seconds> <command...>
  local deadline=$((SECONDS + $1))
  shift
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || return 1
    sleep 3
  done
}

log "Waiting for exec"
wait_for 600 incus exec "${p[@]}" "$NAME" -- test -e /var/lib/cloud/instance/boot-finished ||
  fail "Incus' exec did not reach the test VM within 10 minutes." "Check that vhost_vsock is loaded (lsmod) and see the log."

log "Checking the network"
code=$(incus exec "${p[@]}" "$NAME" -- curl -sS -m 20 -o /dev/null -w '%{http_code}' https://deb.debian.org/ 2>&1) ||
  fail "The test VM cannot reach the internet ($code)." \
    "A firewall drops forwarding for $network (iptables-legacy rules are not visible to nft); allow $network there."
gateway=$(incus exec "${p[@]}" "$NAME" -- sh -c "ip -4 route show default | awk '{print \$3; exit}'")
if incus exec "${p[@]}" "$NAME" -- timeout 5 bash -c "exec 3<>/dev/tcp/$gateway/22" >/dev/null 2>&1; then
  fail "The test VM reached its gateway $gateway on port 22." "Put the egress ACL on $network (install.sh does)."
fi
note "exec, internet, gateway closed"
