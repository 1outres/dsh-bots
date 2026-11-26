#!/usr/bin/env bash
set -eEuo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../vm/lib.sh
. "$HERE/../vm/lib.sh"
# shellcheck source=objects.sh
. "$HERE/objects.sh"
trap on_error ERR

MIN_INCUS=6.0.4

usage() {
  cat <<EOF
Usage: create-project.sh --pool <pool> (--network <network> | --bridge <name> --cidr <a.b.c.d/nn>)
                         --cpu <n> --memory <size> --disk <size> [options]

  --remote <name>       the incus remote of the server (default: this machine's Incus)
  --project <name>      the project to create or update (default: dsh-bots)
  --pool <pool>         the storage pool bot VMs and their workspaces use; every other
                        pool gets limits.disk.pool.<pool>=0 in the project
  --network <network>   an existing network bot VMs attach to, or
  --bridge <name>       a new bridge for them (IPv4 NAT, DHCP, the recommended ACL), with
  --cidr <a.b.c.d/nn>   its gateway address (e.g. 10.240.81.1/24)
  --acl <acl>           the network ACL that already limits what bot VMs reach, or
  --create-acl <acl>    create or update the recommended one (internet only: no private,
                        CGNAT or link-local networks, no IPv6, not the server); a new
                        bridge uses it; an existing --network only with --attach-acl
  --attach-acl          set --create-acl's ACL on the existing --network (its other
                        instances get it too, and default actions reject)
  --cpu <n>             limits.cpu of the project (all bot VMs together)
  --memory <size>       limits.memory (e.g. 32GiB)
  --disk <size>         limits.disk and limits.disk.pool.<pool> (e.g. 400GiB)
  --vms <n>             limits.virtual-machines (default: none)
  --client-name <name>  name of the DSH's certificate in the trust store (default: dsh-bots)
  --no-token            do not issue a trust token
EOF
}

REMOTE="" PROJECT=dsh-bots POOL="" NETWORK="" BRIDGE="" CIDR="" ACL_NAME="" CREATE_ACL="" ATTACH_ACL=0
LIMIT_CPU="" LIMIT_MEMORY="" LIMIT_DISK="" LIMIT_VMS="" CLIENT_NAME=dsh-bots TOKEN=1
while (($#)); do
  case $1 in
    --remote) REMOTE=${2:?--remote needs a value}; shift ;;
    --project) PROJECT=${2:?--project needs a value}; shift ;;
    --pool) POOL=${2:?--pool needs a value}; shift ;;
    --network) NETWORK=${2:?--network needs a value}; shift ;;
    --bridge) BRIDGE=${2:?--bridge needs a value}; shift ;;
    --cidr) CIDR=${2:?--cidr needs a value}; shift ;;
    --acl) ACL_NAME=${2:?--acl needs a value}; shift ;;
    --create-acl) CREATE_ACL=${2:?--create-acl needs a value}; shift ;;
    --attach-acl) ATTACH_ACL=1 ;;
    --cpu) LIMIT_CPU=${2:?--cpu needs a value}; shift ;;
    --memory) LIMIT_MEMORY=${2:?--memory needs a value}; shift ;;
    --disk) LIMIT_DISK=${2:?--disk needs a value}; shift ;;
    --vms) LIMIT_VMS=${2:?--vms needs a value}; shift ;;
    --client-name) CLIENT_NAME=${2:?--client-name needs a value}; shift ;;
    --no-token) TOKEN=0 ;;
    -h | --help) usage; exit 0 ;;
    *) fail "Unknown option $1." "Run create-project.sh --help." ;;
  esac
  shift
done

[[ -n $POOL ]] || fail "No --pool given." "Name the storage pool bot VMs use (create-project.sh --help)."
[[ -n $NETWORK || -n $BRIDGE ]] || fail "Neither --network nor --bridge given." "Name an existing network, or a new bridge with --cidr."
[[ -z $NETWORK || -z $BRIDGE ]] || fail "Both --network and --bridge given." "Give one of them."
[[ -z $BRIDGE || -n $CIDR ]] || fail "--bridge needs --cidr." "Give the bridge's gateway address, e.g. --cidr 10.240.81.1/24."
[[ -z $ACL_NAME || -z $CREATE_ACL ]] || fail "Both --acl and --create-acl given." "Give one of them."
[[ -z $BRIDGE || -n $CREATE_ACL ]] || fail "A new bridge needs --create-acl." "Add --create-acl dsh-bot-egress (or another name)."
((!ATTACH_ACL)) || [[ -n $NETWORK && -n $CREATE_ACL ]] || fail "--attach-acl needs --network and --create-acl." "Give both, or leave it out."
[[ -n $LIMIT_CPU && -n $LIMIT_MEMORY && -n $LIMIT_DISK ]] ||
  fail "--cpu, --memory and --disk are all needed." "Give the share of this server bot VMs may use together; dsh-bots sizes bots within it."
INCUS_REMOTE=$REMOTE
command -v incus >/dev/null || fail "The incus client is not installed." "Install it (it is part of Incus)."

log "Server"
info=$(incus query "$(server)/1.0") || fail "Incus ${REMOTE:-on this machine} does not answer." "Check incus remote list and that you may use the server."
version=$(sed -n 's/^[[:space:]]*"server_version": "\([^"]*\)".*/\1/p' <<<"$info" | head -n1)
version_ge "$version" "$MIN_INCUS" || fail "Incus ${version:-(unknown)} is older than $MIN_INCUS." "Upgrade Incus to $MIN_INCUS or newer."
grep -q '"auth": "trusted"' <<<"$info" || fail "The server does not trust this client." "Use a client with full access to the server."
grep -qw qemu <<<"$(incus info "$(server)" | awk '/^  driver:/')" ||
  fail "This Incus cannot run virtual machines (no qemu driver)." "Install QEMU on the server; its journal says why."
address=$(incus config get "$(server)" core.https_address)
[[ -n $address ]] || fail "The server does not listen on HTTPS (core.https_address is unset), so DSH cannot reach it." \
  "Set it, e.g. incus config set core.https_address=:8443, and open that port to the DSH host."
note "Incus $version, $address"

log "Network"
ACL=$ACL_NAME
if [[ -n $BRIDGE ]]; then
  NETWORK=$BRIDGE
  ACL=$CREATE_ACL
  ensure_egress_acl "$ACL" "${CIDR%/*}"
  ensure_bridge "$BRIDGE" "$CIDR" "$ACL"
elif [[ -n $CREATE_ACL ]]; then
  ACL=$CREATE_ACL
  gateway=$(gateway_of "$NETWORK")
  [[ -n $gateway ]] || fail "The network $NETWORK has no IPv4 address on the server, so the ACL cannot name its gateway." \
    "Use --acl with an ACL you made for it, or --bridge for a new one."
  ensure_egress_acl "$ACL" "$gateway"
  if ((ATTACH_ACL)); then
    incus network set "$(at "$NETWORK")" security.acls="$ACL" \
      security.acls.default.egress.action=reject security.acls.default.ingress.action=reject
  fi
fi

log "Project"
LIMIT_VMS=$LIMIT_VMS LIMIT_CPU=$LIMIT_CPU LIMIT_MEMORY=$LIMIT_MEMORY LIMIT_DISK=$LIMIT_DISK \
  ensure_project "$PROJECT" "$POOL" "$NETWORK" "$ACL"
note "project $PROJECT: pool $POOL, network $NETWORK, ACL ${ACL:-(none declared)}"
if [[ -n $CREATE_ACL && -n $NETWORK && $ATTACH_ACL == 0 && -z $BRIDGE ]]; then
  printf '\nThe ACL %s is not on %s yet: dsh-bots cannot check it, and declares it only.\n' "$ACL" "$NETWORK"
  printf 'Put it there when its other instances may have it: incus network set %s security.acls=%s\n' "$(at "$NETWORK")" "$ACL"
fi
if [[ -z $ACL ]]; then
  printf '\nNo ACL declared: the dsh-bots settings warn that the bots'"'"' egress is unrestricted.\n'
fi

cat <<EOF

Note: while a DSH has a connection open to one of its bots, stopping or restarting
incusd waits for it up to core.shutdown_timeout (5 minutes by default), and new
connections fail meanwhile (docs/specs/incus-endpoint.md §8.2). dsh-bots closes
idle connections after 5 minutes.
EOF

if ((TOKEN)); then
  token=$(issue_token "$CLIENT_NAME" "$PROJECT")
  printf '\nPaste this trust token in DSH: dsh-bots settings → VM host → Another machine.\n\n%s\n\n' "$token"
  printf 'It pairs one DSH, once. To end it later: incus config trust remove %s<first 12 of its fingerprint>.\n' "$(server)"
fi
