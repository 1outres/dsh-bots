#!/usr/bin/env bash
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
  fail project-missing "There is no project $PROJECT." "Build this VM host in the dsh-bots settings (Build on this machine) or with sudo infra/vm/host-setup.sh all."
network=$(incus project get "$PROJECT" user.dsh-bots.network)
[[ -n $pool && -n $network ]] || fail project-undeclared "The project $PROJECT declares no user.dsh-bots.pool / network." "Build this VM host in the dsh-bots settings (Build on this machine) or with sudo infra/vm/host-setup.sh all (it declares them)."
[[ -n $(alias_target "$PROJECT" "$IMAGE") ]] ||
  fail image-missing "The project $PROJECT has no image $IMAGE yet." "Import it in DSH: dsh-bots settings → VM host → Base image."

cleanup() { incus delete "${p[@]}" --force "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

log "Creating $NAME"
incus init -q "${p[@]}" "$IMAGE" "$NAME" --vm --no-profiles --storage "$pool" --network "$network" -d root,size=16GiB \
  -c limits.cpu=2 -c limits.memory=2GiB -c security.guestapi=false -c security.secureboot=false -c boot.autostart=false
incus config device set "${p[@]}" "$NAME" eth0 \
  security.port_isolation=true security.mac_filtering=true security.ipv4_filtering=true
incus start "${p[@]}" "$NAME" || fail vm-check-failed "The test VM did not start." "See the log; incus info --show-log $NAME --project $PROJECT shows QEMU's output."

wait_for() {
  local deadline=$((SECONDS + $1))
  shift
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || return 1
    sleep 3
  done
}

log "Waiting for exec"
wait_for 600 incus exec "${p[@]}" "$NAME" -- test -e /var/lib/cloud/instance/boot-finished ||
  fail vm-check-failed "Incus' exec did not reach the test VM within 10 minutes." "Check that vhost_vsock is loaded (lsmod) and see the log."

log "Checking the network"
code=$(incus exec "${p[@]}" "$NAME" -- curl -sS -m 20 -o /dev/null -w '%{http_code}' https://deb.debian.org/ 2>&1) ||
  fail vm-check-failed "The test VM cannot reach the internet ($code)." \
    "A firewall drops forwarding for $network (iptables-legacy rules are not visible to nft); allow $network there."
gateway=$(incus exec "${p[@]}" "$NAME" -- sh -c "ip -4 route show default | awk '{print \$3; exit}'")
if incus exec "${p[@]}" "$NAME" -- timeout 5 bash -c "exec 3<>/dev/tcp/$gateway/22" >/dev/null 2>&1; then
  fail vm-check-failed "The test VM reached its gateway $gateway on port 22." "Put the egress ACL on $network (host-setup.sh incus does)."
fi

log "Checking the guest"
listening=$(incus exec "${p[@]}" "$NAME" -- ss -Hltn 'sport = :22')
[[ -z $listening ]] || fail vm-check-failed "sshd listens on TCP port 22 in the test VM: $listening." \
  "Rebuild the image with provision-base.sh: on Incus sshd is reached only through exec (ssh.service and ssh.socket stay masked)."
failed=$(incus exec "${p[@]}" "$NAME" -- systemctl list-units --failed --plain --no-legend)
[[ -z $failed ]] || fail vm-check-failed "Units failed in the test VM: $failed." \
  "Look at those units in a bot VM (systemctl status <unit>) and fix the image (provision-base.sh)."
note "exec, internet, gateway closed, no TCP sshd, no failed unit"
