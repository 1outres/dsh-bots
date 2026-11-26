# shellcheck shell=bash
# The Incus objects bot VMs need (docs/specs/incus-endpoint.md §3.4), shared by
# infra/vm/host-setup.sh (this machine's Incus) and infra/incus/create-project.sh
# (an Incus server reached as a remote). Needs fail of infra/vm/lib.sh.
#
# INCUS_REMOTE: the incus remote to talk to; empty for this machine's Incus.

# at <name>: the name as incus addresses it on INCUS_REMOTE.
at() { printf '%s%s' "${INCUS_REMOTE:+$INCUS_REMOTE:}" "$1"; }

# server: the argument naming the whole server, for commands that list it.
server() { printf '%s' "${INCUS_REMOTE:+$INCUS_REMOTE:}"; }

# ensure_egress_acl <acl> <gateway IPv4>: the bots' egress ACL, internet only.
ensure_egress_acl() {
  local acl=$1 gateway=$2
  incus network acl show "$(at "$acl")" >/dev/null 2>&1 || incus network acl create "$(at "$acl")"
  # Rule order is decided by Incus by action: drop > reject > allow > default.
  # Baseline services on the bridge (DHCP, DNS to the gateway) are allowed before the ACL.
  incus network acl edit "$(at "$acl")" <<EOF
description: "dsh bot VMs: internet only; no host, no private/CGNAT/link-local networks"
egress:
- action: reject
  description: private, CGNAT, loopback, link-local, multicast, reserved
  destination: 0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.0.0.0/24,192.168.0.0/16,198.18.0.0/15,224.0.0.0/3,$gateway/32
  state: enabled
- action: reject
  description: all IPv6 (the bridge is IPv4-only)
  destination: ::/0
  state: enabled
- action: allow
  description: public IPv4 internet
  destination: 0.0.0.0/0
  state: enabled
ingress: []
config: {}
EOF
}

# ensure_bridge <network> <CIDR> <acl>: an IPv4-only NAT bridge whose traffic the ACL decides.
ensure_bridge() {
  local net=$1 cidr=$2 acl=$3
  if ! incus network show "$(at "$net")" >/dev/null 2>&1; then
    incus network create "$(at "$net")" --type=bridge ipv4.address="$cidr" ipv4.nat=true ipv6.address=none
  fi
  incus network set "$(at "$net")" \
    ipv4.address="$cidr" ipv4.nat=true ipv4.dhcp=true ipv4.firewall=true \
    ipv6.address=none \
    dns.domain=dsh-bots.internal \
    security.acls="$acl" \
    security.acls.default.egress.action=reject \
    security.acls.default.ingress.action=reject
  incus network unset "$(at "$net")" raw.dnsmasq
  incus network set "$(at "$net")" --property description="dsh bot VMs (isolated, internet-only)"
}

# gateway_of <network>: the network's IPv4 address, without the prefix length; empty without one.
gateway_of() {
  local address
  address=$(incus network get "$(at "$1")" ipv4.address 2>/dev/null) || address=""
  printf '%s' "${address%/*}"
}

PROJECT_FEATURES=(features.images=true features.profiles=true features.storage.volumes=true features.networks=false)

# ensure_project <project> <pool> <network> <egress acl, or empty>: the project bot VMs run in.
# Limits from LIMIT_VMS, LIMIT_CPU, LIMIT_MEMORY and LIMIT_DISK, each only when set.
ensure_project() {
  local project=$1 pool=$2 net=$3 acl=$4 setting key value current
  [[ $project != default ]] || fail "The project for bot VMs cannot be \"default\"." "Give another project name."
  incus storage show "$(at "$pool")" >/dev/null 2>&1 || fail "There is no storage pool $pool." "Create it or name an existing one."
  incus network show "$(at "$net")" >/dev/null 2>&1 || fail "There is no network $net." "Create it or name an existing one."
  if ! incus project show "$(at "$project")" >/dev/null 2>&1; then
    local create=()
    for setting in "${PROJECT_FEATURES[@]}"; do create+=(-c "$setting"); done
    incus project create "$(at "$project")" "${create[@]}"
    incus project set "$(at "$project")" --property description="dsh-bots: bot VMs"
  fi
  for setting in "${PROJECT_FEATURES[@]}"; do
    key=${setting%%=*} value=${setting#*=}
    current=$(incus project get "$(at "$project")" "$key")
    [[ $current == "$value" ]] || fail "The project $project exists with $key=${current:-unset}; bot VMs need $value." \
      "Use a project made for dsh-bots: give another name, or delete $project if nothing uses it."
  done
  local settings=(
    restricted=true
    restricted.networks.access="$net"
    user.dsh-bots.pool="$pool"
    user.dsh-bots.network="$net"
  )
  local other
  while IFS= read -r other; do
    [[ -z $other || $other == "$pool" ]] || settings+=("limits.disk.pool.$other=0")
  done < <(incus storage list "$(server)" -f csv -c n)
  [[ -z $acl ]] || settings+=(user.dsh-bots.egress-acl="$acl")
  [[ -z ${LIMIT_VMS:-} ]] || settings+=(limits.virtual-machines="$LIMIT_VMS")
  [[ -z ${LIMIT_CPU:-} ]] || settings+=(limits.cpu="$LIMIT_CPU")
  [[ -z ${LIMIT_MEMORY:-} ]] || settings+=(limits.memory="$LIMIT_MEMORY")
  [[ -z ${LIMIT_DISK:-} ]] || settings+=(limits.disk="$LIMIT_DISK" "limits.disk.pool.$pool=$LIMIT_DISK")
  incus project set "$(at "$project")" "${settings[@]}"
  [[ -n $acl ]] || incus project unset "$(at "$project")" user.dsh-bots.egress-acl
}

# issue_token <client name> <project>: a trust token for one client certificate restricted to
# the project, on stdout. Unused tokens of the same name are revoked first.
issue_token() {
  local name=$1 project=$2 pending output token
  while IFS= read -r pending; do
    [[ $pending != "$name" ]] || incus config trust revoke-token "$(at "$name")" >&2
  done < <(incus config trust list-tokens "$(server)" -f csv -c n)
  output=$(incus config trust add "$(at "$name")" --restricted --projects "$project")
  token=$(printf '%s\n' "$output" | awk 'NF {line = $0} END {print line}')
  [[ $token =~ ^[A-Za-z0-9+/=]+$ ]] || fail "incus config trust add printed no token." "See the log for what it printed."
  printf '%s\n' "$token"
}
