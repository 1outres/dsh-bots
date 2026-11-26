# shellcheck shell=bash

at() { printf '%s%s' "${INCUS_REMOTE:+$INCUS_REMOTE:}" "$1"; }

server() { printf '%s' "${INCUS_REMOTE:+$INCUS_REMOTE:}"; }

shown() { incus "$@" 2>/dev/null || true; }

ensure_egress_acl() {
  local acl=$1 gateway=$2 before
  before=$(shown network acl show "$(at "$acl")")
  [[ -n $before ]] || incus network acl create "$(at "$acl")"
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
  [[ $(incus network acl show "$(at "$acl")") == "$before" ]] || mark_changed
}

ensure_bridge() {
  local net=$1 cidr=$2 acl=$3 before
  before=$(shown network show "$(at "$net")")
  if [[ -z $before ]]; then
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
  [[ $(incus network show "$(at "$net")") == "$before" ]] || mark_changed
}

gateway_of() {
  local address
  address=$(incus network get "$(at "$1")" ipv4.address 2>/dev/null) || address=""
  printf '%s' "${address%/*}"
}

PROJECT_FEATURES=(features.images=true features.profiles=true features.storage.volumes=true features.networks=false)

ensure_project() {
  local project=$1 pool=$2 net=$3 acl=$4 setting key value current before
  [[ $project != default ]] || fail project-conflict "The project for bot VMs cannot be \"default\"." "Give another project name."
  before=$(shown project show "$(at "$project")")
  if [[ -z $before ]]; then
    local create=()
    for setting in "${PROJECT_FEATURES[@]}"; do create+=(-c "$setting"); done
    incus project create "$(at "$project")" "${create[@]}"
    incus project set "$(at "$project")" --property description="dsh-bots: bot VMs"
  fi
  for setting in "${PROJECT_FEATURES[@]}"; do
    key=${setting%%=*} value=${setting#*=}
    current=$(incus project get "$(at "$project")" "$key")
    [[ $current == "$value" ]] || fail project-conflict "The project $project exists with $key=${current:-unset}; bot VMs need $value." \
      "Use a project made for dsh-bots: give another name, or delete $project if nothing uses it."
  done
  local settings=(
    restricted=true
    restricted.networks.access="$net"
    user.dsh-bots.pool="$pool"
    user.dsh-bots.network="$net"
  )
  local other pools
  pools=$(incus storage list "$(server)" -f csv -c n)
  while IFS= read -r other; do
    [[ -z $other || $other == "$pool" ]] || settings+=("limits.disk.pool.$other=0")
  done <<<"$pools"
  [[ -z $acl ]] || settings+=(user.dsh-bots.egress-acl="$acl")
  [[ -z ${LIMIT_VMS:-} ]] || settings+=(limits.virtual-machines="$LIMIT_VMS")
  [[ -z ${LIMIT_CPU:-} ]] || settings+=(limits.cpu="$LIMIT_CPU")
  [[ -z ${LIMIT_MEMORY:-} ]] || settings+=(limits.memory="$LIMIT_MEMORY")
  [[ -z ${LIMIT_DISK:-} ]] || settings+=(limits.disk="$LIMIT_DISK" "limits.disk.pool.$pool=$LIMIT_DISK")
  incus project set "$(at "$project")" "${settings[@]}"
  [[ -n $acl ]] || incus project unset "$(at "$project")" user.dsh-bots.egress-acl
  [[ $(incus project show "$(at "$project")") == "$before" ]] || mark_changed
}

issue_token() {
  local name=$1 project=$2 pending tokens output
  tokens=$(incus config trust list-tokens "$(server)" -f csv -c n)
  while IFS= read -r pending; do
    [[ $pending != "$name" ]] || incus config trust revoke-token "$(at "$name")" >&2
  done <<<"$tokens"
  output=$(incus config trust add "$(at "$name")" --restricted --projects "$project")
  TOKEN=$(awk 'NF {line = $0} END {print line}' <<<"$output")
  [[ $TOKEN =~ ^[A-Za-z0-9+/=]+$ ]] ||
    fail token-missing "incus config trust add printed no token." "Check that this Incus issues trust tokens (incus config trust list-tokens)."
}
