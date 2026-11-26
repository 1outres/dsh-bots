#!/usr/bin/env bash
# VM host setup for dsh-bots: the machine that runs the bots' Incus VMs. Runs as
# root, never asks, and is idempotent: every phase checks what is there and
# changes only the rest.
#
# Usage: ./host-setup.sh <phase>...
#   packages  Incus, QEMU and the file system tools
#   incus     storage pool, bridge, network ACL and the project bot VMs run in
#   firewall  ufw / firewalld / Docker forwarding for the bridge
#   all       the three above, in this order
#   local     DSH runs on this machine: DSH_USER joins incus-admin (the Unix socket)
#   remote    DSH runs on another machine: core.https_address and a trust token
#             restricted to the project (written to DSH_BOTS_TOKEN_FILE, else printed)
#
# Environment:
#   DSH_USER                  with local: the user that runs DSH
#   DSH_BOTS_THIRD_PARTY=yes  allow the third-party Incus repository this OS needs
#                             (Zabbly on Debian 12 / Ubuntu 24.04)
#   POOL (dsh), POOL_SIZE (80GiB), NET (dshbr0), NET_CIDR (10.240.80.1/24),
#   ACL (dsh-bot-egress), PROJECT (dsh-bots), LIMIT_VMS / LIMIT_CPU / LIMIT_MEMORY /
#   LIMIT_DISK (the project's limits, none by default),
#   HTTPS_ADDRESS (:8443, when core.https_address is unset), CLIENT_NAME (dsh-bots)
set -eEuo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck source=../incus/objects.sh
. "$HERE/../incus/objects.sh"
trap on_error ERR

[[ $EUID -eq 0 ]] || fail "host-setup.sh must run as root." "Run it with sudo, or use install.sh."

POOL=${POOL:-dsh}
POOL_SIZE=${POOL_SIZE:-80GiB}
NET=${NET:-dshbr0}
NET_CIDR=${NET_CIDR:-10.240.80.1/24}
ACL=${ACL:-dsh-bot-egress}
PROJECT=${PROJECT:-dsh-bots}
HTTPS_ADDRESS=${HTTPS_ADDRESS:-:8443}
CLIENT_NAME=${CLIENT_NAME:-dsh-bots}
GW_IP=${NET_CIDR%/*}
MIN_INCUS=6.0.4
MODULES_FILE=/etc/modules-load.d/dsh-bots.conf

detect_os
[[ $OS_FAMILY != unsupported ]] || fail "This machine cannot be a VM host: $OS_WHY." "Use one of the VM hosts in the README."
# Debian 12 has no Incus, Ubuntu 24.04's is 6.0.0: both use the Incus maintainers' packages (Zabbly).
case $OS_ID:$OS_VERSION in
  debian:12 | ubuntu:24.04) INCUS_SOURCE=zabbly ;;
  *) INCUS_SOURCE=distro ;;
esac

need_third_party() {
  [[ ${DSH_BOTS_THIRD_PARTY:-} == yes ]] ||
    fail "Incus for $OS_NAME comes from the third-party repository $1." "Allow it with DSH_BOTS_THIRD_PARTY=yes (install.sh asks)."
}

# ---------------------------------------------------------------- packages
zabbly_source() {
  local key=/etc/apt/keyrings/zabbly.asc list=/etc/apt/sources.list.d/zabbly-incus-lts-6.0.sources codename
  if [[ ! -s $key ]]; then
    install -d -m 0755 /etc/apt/keyrings
    curl -fsSL https://pkgs.zabbly.com/key.asc -o "$key.tmp"
    gpg --show-keys --with-colons "$key.tmp" | grep -q '^fpr:::::::::4EFC590696CB15B87C73A3AD82CC8797C838DCFD:' ||
      { rm -f "$key.tmp"; fail "The Zabbly signing key has an unexpected fingerprint." "Check https://github.com/zabbly/incus and your network."; }
    mv "$key.tmp" "$key"
  fi
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  if [[ ! -f $list ]]; then
    printf 'Enabled: yes\nTypes: deb\nURIs: https://pkgs.zabbly.com/incus/lts-6.0\nSuites: %s\nComponents: main\nArchitectures: amd64\nSigned-By: %s\n' \
      "$codename" "$key" >"$list"
    apt-get update -q
  fi
}

apt_install() {
  local missing=() p
  for p in "$@"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
  done
  ((${#missing[@]})) || return 0
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
}

phase_packages() {
  log "Packages ($OS_NAME, Incus from $INCUS_SOURCE)"
  case $OS_FAMILY in
    debian)
      if [[ $INCUS_SOURCE == zabbly ]]; then
        need_third_party "Zabbly (pkgs.zabbly.com, the Incus maintainers' packages)"
        apt_install ca-certificates curl gpg
        zabbly_source
        apt_install incus btrfs-progs e2fsprogs nftables zstd
      else
        apt_install incus incus-client incus-agent qemu-system-x86 qemu-system-modules-spice qemu-utils ovmf \
          swtpm dnsmasq-base btrfs-progs e2fsprogs nftables zstd
      fi
      ;;
    fedora)
      dnf install -y incus incus-agent qemu-system-x86-core edk2-ovmf swtpm btrfs-progs e2fsprogs nftables zstd
      ;;
  esac
  # Incus' exec reaches a VM's incus-agent over vsock.
  printf '%s\n' "# Managed by dsh-bots infra/vm/host-setup.sh" vhost_vsock >"$MODULES_FILE"
  [[ -d /sys/module/vhost_vsock ]] || modprobe vhost_vsock ||
    fail "Loading the kernel module vhost_vsock failed." "Check that the running kernel ships it (modinfo vhost_vsock)."
  systemctl enable --now incus.socket >/dev/null 2>&1 || true
  systemctl enable incus.service >/dev/null 2>&1 || true
  systemctl start incus.service
  incus admin waitready --timeout=120
  local version
  version=$(incus version | awk -F': *' '/^Server version/ {print $2}')
  version_ge "$version" "$MIN_INCUS" ||
    fail "Incus $version is older than $MIN_INCUS." "Upgrade Incus to $MIN_INCUS or newer."
  incus info | awk '/^  driver:/' | grep -qw qemu ||
    fail "This Incus cannot run virtual machines (no qemu driver)." "Check /dev/kvm and QEMU; journalctl -u incus says why."
  note "Incus $version"
}

# ---------------------------------------------------------------- incus
phase_incus() {
  log "Incus objects"
  incus storage show "$POOL" >/dev/null 2>&1 || incus storage create "$POOL" btrfs size="$POOL_SIZE"
  ensure_egress_acl "$ACL" "$GW_IP"
  ensure_bridge "$NET" "$NET_CIDR" "$ACL"
  ensure_project "$PROJECT" "$POOL" "$NET" "$ACL"
  note "project $PROJECT (pool $POOL, network $NET)"
}

# ---------------------------------------------------------------- firewall
DOCKER_UNIT=/etc/systemd/system/dsh-bots-docker-forward.service

docker_unit() {
  local iptables
  iptables=$(command -v iptables) || fail "Docker filters forwarding but iptables is missing." "Install iptables."
  cat >"$DOCKER_UNIT.tmp" <<EOF
# Managed by dsh-bots infra/vm/host-setup.sh
# Docker drops forwarded traffic it does not know (FORWARD policy DROP); let
# the dsh bot bridge $NET through its DOCKER-USER chain.
[Unit]
Description=dsh-bots: let $NET through Docker's forward filter
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '$iptables -C DOCKER-USER -i $NET -j ACCEPT 2>/dev/null || $iptables -I DOCKER-USER -i $NET -j ACCEPT'
ExecStart=/bin/sh -c '$iptables -C DOCKER-USER -o $NET -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || $iptables -I DOCKER-USER -o $NET -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'

[Install]
WantedBy=docker.service
EOF
  if ! cmp -s "$DOCKER_UNIT.tmp" "$DOCKER_UNIT"; then
    mv "$DOCKER_UNIT.tmp" "$DOCKER_UNIT"
    systemctl daemon-reload
    systemctl enable dsh-bots-docker-forward.service >/dev/null 2>&1
    systemctl restart dsh-bots-docker-forward.service
  else
    rm -f "$DOCKER_UNIT.tmp"
    systemctl start dsh-bots-docker-forward.service
  fi
}

# Base chains of a forward hook with policy drop, outside Incus' own table: "<family> <table> <chain>".
dropping_forward_chains() {
  nft list chains 2>/dev/null | awk '
    $1 == "table" { table = $2 " " $3 }
    $1 == "chain" { chain = $2 }
    /hook forward/ && /policy drop/ && table != "inet incus" { print table " " chain }'
}

ufw_active() { command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; }
firewalld_running() { command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; }

phase_firewall() {
  log "Firewall"
  local handled=()
  if ufw_active; then
    ufw allow in on "$NET" >/dev/null
    ufw route allow in on "$NET" >/dev/null
    ufw route allow out on "$NET" >/dev/null
    handled+=("ufw")
  fi
  if firewalld_running; then
    if ! firewall-cmd --permanent --zone=trusted --query-interface="$NET" >/dev/null 2>&1; then
      firewall-cmd --permanent --zone=trusted --add-interface="$NET" >/dev/null
      firewall-cmd --reload >/dev/null
    fi
    handled+=("firewalld")
  fi
  if command -v iptables >/dev/null && iptables -S DOCKER-USER >/dev/null 2>&1; then
    docker_unit
    handled+=("Docker")
  fi
  if ((${#handled[@]})); then
    local list
    list=$(printf '%s, ' "${handled[@]}")
    note "allowed $NET in ${list%, }"
    return 0
  fi
  local dropping
  dropping=$(dropping_forward_chains)
  [[ -z $dropping ]] || fail "The firewall drops forwarded traffic (${dropping//$'\n'/, }), so bot VMs would have no network." \
    "Allow forwarding from and to $NET in that firewall, then run this again."
}

# ---------------------------------------------------------------- local
phase_local() {
  log "Socket access for the DSH user"
  [[ -n ${DSH_USER:-} ]] || fail "DSH_USER is not set." "Set DSH_USER to the user that runs DSH."
  [[ $DSH_USER != root ]] || fail "DSH_USER is root." "Run DSH and set DSH_USER as an ordinary user."
  id "$DSH_USER" >/dev/null 2>&1 || fail "User $DSH_USER does not exist." "Set DSH_USER to the user that runs DSH."
  getent group incus-admin >/dev/null || fail "The group incus-admin does not exist." "Reinstall Incus; its package creates the group."
  if id -nG "$DSH_USER" | tr ' ' '\n' | grep -qx incus-admin; then
    note "$DSH_USER is in incus-admin"
    return 0
  fi
  usermod -aG incus-admin "$DSH_USER"
  note "$DSH_USER joined incus-admin"
}

# ---------------------------------------------------------------- remote
phase_remote() {
  log "HTTPS API and a trust token"
  local address port
  address=$(incus config get core.https_address)
  if [[ -z $address ]]; then
    incus config set core.https_address="$HTTPS_ADDRESS"
    address=$HTTPS_ADDRESS
  fi
  port=${address##*:}
  [[ $port =~ ^[0-9]+$ ]] || port=8443
  if ufw_active; then ufw allow "$port/tcp" >/dev/null; fi
  if firewalld_running && ! firewall-cmd --permanent --query-port="$port/tcp" >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$port/tcp" >/dev/null
    firewall-cmd --reload >/dev/null
  fi
  local token
  token=$(issue_token "$CLIENT_NAME" "$PROJECT")
  if [[ -n ${DSH_BOTS_TOKEN_FILE:-} ]]; then
    printf '%s\n' "$token" >"$DSH_BOTS_TOKEN_FILE"
  else
    printf '%s\n' "$token"
  fi
  note "listening on $address, token for $CLIENT_NAME"
}

(($#)) || fail "No phase given." "Run: host-setup.sh packages|incus|firewall|all|local|remote"
for phase in "$@"; do
  case $phase in
    packages) phase_packages ;;
    incus) phase_incus ;;
    firewall) phase_firewall ;;
    all) phase_packages; phase_incus; phase_firewall ;;
    local) phase_local ;;
    remote) phase_remote ;;
    *) fail "Unknown phase $phase." "Run: host-setup.sh packages|incus|firewall|all|local|remote" ;;
  esac
done
