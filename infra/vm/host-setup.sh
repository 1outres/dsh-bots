#!/usr/bin/env bash
# Host setup for per-bot Incus VMs (dsh-bots). Runs as root, never asks, and
# is idempotent: every phase checks what is there and changes only the rest.
#
# Usage: DSH_USER=<user> ./host-setup.sh <phase>...
#   packages    Incus, QEMU, virtiofsd, socat and the file system tools
#   incus       storage pool, bridge, network ACL, profile, incus-admin group
#   firewall    ufw / firewalld / Docker forwarding for the bridge
#   workspaces  the bots' shared directory (bind mount nosuid,nodev,nosymfollow)
#               and the Include in the DSH user's ~/.ssh/config
#   all         every phase, in this order
#
# Environment:
#   DSH_USER                  user that runs DSH (required)
#   DSH_BOTS_THIRD_PARTY=yes  allow the third-party Incus repository this OS needs
#                             (Zabbly on Debian 12 / Ubuntu 24.04)
#   POOL (dsh), POOL_SIZE (80GiB), NET (dshbr0), NET_CIDR (10.240.80.1/24),
#   ACL (dsh-bot-egress), PROFILE (dsh-bot), BOT_CPU / BOT_MEM / BOT_DISK
#   (2 / 2GiB / 10GiB; dsh-bot-vm gives each VM its own spec, these apply to
#   other VMs of the profile), BOTS_ROOT (~DSH_USER/.dsh/bots, dsh-bot-vm's hostRoot)
set -eEuo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
trap on_error ERR

[[ $EUID -eq 0 ]] || fail "host-setup.sh must run as root." "Run it with sudo, or use install.sh."
[[ -n ${DSH_USER:-} ]] || fail "DSH_USER is not set." "Set DSH_USER to the user that runs DSH."
[[ $DSH_USER != root ]] || fail "DSH_USER is root." "Run DSH and set DSH_USER as an ordinary user."
id "$DSH_USER" >/dev/null 2>&1 || fail "User $DSH_USER does not exist." "Set DSH_USER to the user that runs DSH."

POOL=${POOL:-dsh}
POOL_SIZE=${POOL_SIZE:-80GiB}
NET=${NET:-dshbr0}
NET_CIDR=${NET_CIDR:-10.240.80.1/24}
ACL=${ACL:-dsh-bot-egress}
PROFILE=${PROFILE:-dsh-bot}
BOT_CPU=${BOT_CPU:-2}
BOT_MEM=${BOT_MEM:-2GiB}
BOT_DISK=${BOT_DISK:-10GiB}
GW_IP=${NET_CIDR%/*}
DSH_HOME=$(getent passwd "$DSH_USER" | cut -d: -f6)
DSH_GROUP=$(id -gn "$DSH_USER")
BOTS_ROOT=${BOTS_ROOT:-$DSH_HOME/.dsh/bots}
[[ $BOTS_ROOT == /* ]] || fail "BOTS_ROOT ($BOTS_ROOT) is not absolute." "Give BOTS_ROOT as an absolute path."
MIN_INCUS=6.0.4
MODULES_FILE=/etc/modules-load.d/dsh-bots.conf

detect_os
[[ $OS_FAMILY != unsupported ]] || fail "This OS is not supported: $OS_WHY." "Use one of the supported systems (see README)."
# Debian 12 has no virtiofsd, Ubuntu 24.04's Incus 6.0.0 no virtiofs disks: both use the
# Incus maintainers' packages (Zabbly), which bring their own QEMU and virtiofsd.
case $OS_ID:$OS_VERSION in
  debian:12 | ubuntu:24.04) INCUS_SOURCE=zabbly ;;
  *) INCUS_SOURCE=distro ;;
esac

as_user() { runuser -u "$DSH_USER" -- "$@"; }

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
        apt_install incus btrfs-progs e2fsprogs nftables socat zstd
      else
        apt_install incus incus-client incus-agent qemu-system-x86 qemu-system-modules-spice qemu-utils ovmf \
          swtpm virtiofsd dnsmasq-base btrfs-progs e2fsprogs nftables socat zstd
      fi
      ;;
    fedora)
      dnf install -y incus incus-agent qemu-system-x86-core edk2-ovmf swtpm virtiofsd btrfs-progs e2fsprogs nftables socat zstd
      ;;
    arch)
      pacman -S --needed --noconfirm incus edk2-ovmf swtpm virtiofsd btrfs-progs e2fsprogs nftables socat zstd
      ;;
    nixos)
      local missing=() c
      for c in incus socat zstd; do command -v "$c" >/dev/null || missing+=("$c"); done
      ((${#missing[@]} == 0)) || fail "${missing[*]} not installed: dsh-bots.nix is not active yet." \
        "Import dsh-bots.nix in your NixOS configuration and run nixos-rebuild switch."
      ;;
  esac
  if [[ $OS_FAMILY != nixos ]]; then
    local modules=(vhost_vsock)
    ((IS_WSL)) && modules+=(kvm "kvm_$(grep -q svm /proc/cpuinfo && echo amd || echo intel)" btrfs bridge)
    printf '%s\n' "# Managed by dsh-bots infra/vm/host-setup.sh" "${modules[@]}" >"$MODULES_FILE"
    local module
    for module in "${modules[@]}"; do
      [[ -d /sys/module/$module ]] || modprobe "$module" ||
        fail "Loading the kernel module $module failed." "Check that the running kernel ships it (modinfo $module)."
    done
  fi
  systemctl enable --now incus.socket >/dev/null 2>&1 || true
  systemctl enable incus.service >/dev/null 2>&1 || true
  systemctl start incus.service
  incus admin waitready --timeout=120
  local server
  server=$(incus version | awk -F': *' '/^Server version/ {print $2}')
  version_ge "$server" "$MIN_INCUS" ||
    fail "Incus $server is older than $MIN_INCUS (virtiofs shares need it)." "Upgrade Incus to $MIN_INCUS or newer."
  incus info | awk '/^  driver:/' | grep -qw qemu ||
    fail "This Incus cannot run virtual machines (no qemu driver)." "Check /dev/kvm and QEMU; journalctl -u incus says why."
  note "Incus $server"
}

# ---------------------------------------------------------------- incus
phase_incus() {
  log "Incus objects"
  getent group incus-admin >/dev/null || fail "The group incus-admin does not exist." "Reinstall Incus; its package creates the group."
  local changed=()
  if ! id -nG "$DSH_USER" | tr ' ' '\n' | grep -qx incus-admin; then
    if [[ $OS_FAMILY == nixos ]]; then
      fail "$DSH_USER is not in incus-admin." "Rebuild NixOS with dsh-bots.nix (users.users.$DSH_USER.extraGroups)."
    fi
    usermod -aG incus-admin "$DSH_USER"
    changed+=("$DSH_USER joined incus-admin")
  fi

  if ! incus storage show "$POOL" >/dev/null 2>&1; then
    incus storage create "$POOL" btrfs size="$POOL_SIZE"
  fi

  incus network acl show "$ACL" >/dev/null 2>&1 || incus network acl create "$ACL"
  # Rule order is decided by Incus by action: drop > reject > allow > default.
  # Baseline services on the bridge (DHCP, DNS to the gateway) are allowed before the ACL.
  incus network acl edit "$ACL" <<EOF
description: "dsh bot VMs: internet only; no host, no private/CGNAT/link-local networks"
egress:
- action: reject
  description: private, CGNAT, loopback, link-local, multicast, reserved
  destination: 0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.0.0.0/24,192.168.0.0/16,198.18.0.0/15,224.0.0.0/3,$GW_IP/32
  state: enabled
- action: reject
  description: all IPv6 (bridge is IPv4-only)
  destination: ::/0
  state: enabled
- action: allow
  description: public IPv4 internet
  destination: 0.0.0.0/0
  state: enabled
ingress: []
config: {}
EOF

  if ! incus network show "$NET" >/dev/null 2>&1; then
    incus network create "$NET" --type=bridge ipv4.address="$NET_CIDR" ipv4.nat=true ipv6.address=none
  fi
  incus network set "$NET" \
    ipv4.address="$NET_CIDR" ipv4.nat=true ipv4.dhcp=true ipv4.firewall=true \
    ipv6.address=none \
    dns.domain=dsh-bots.internal \
    security.acls="$ACL" \
    security.acls.default.egress.action=reject \
    security.acls.default.ingress.action=reject
  incus network unset "$NET" raw.dnsmasq
  incus network set "$NET" --property description="dsh bot VMs (isolated, internet-only)"

  incus profile show "$PROFILE" >/dev/null 2>&1 || incus profile create "$PROFILE"
  incus profile edit "$PROFILE" <<EOF
description: dsh bot VM defaults (use with --vm and -p $PROFILE only)
config:
  limits.cpu: "$BOT_CPU"
  limits.memory: $BOT_MEM
  security.guestapi: "false"
  boot.autostart: "true"
  security.secureboot: "false"
devices:
  root:
    type: disk
    path: /
    pool: $POOL
    size: $BOT_DISK
  eth0:
    type: nic
    name: eth0
    network: $NET
    security.port_isolation: "true"
    security.mac_filtering: "true"
    security.ipv4_filtering: "true"
EOF
  if ((${#changed[@]})); then note "${changed[*]}"; fi
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

phase_firewall() {
  log "Firewall"
  local handled=()
  if [[ $OS_FAMILY == nixos ]]; then
    note "NixOS firewall: $NET trusted by dsh-bots.nix"
    return 0
  fi
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow in on "$NET" >/dev/null
    ufw route allow in on "$NET" >/dev/null
    ufw route allow out on "$NET" >/dev/null
    handled+=("ufw")
  fi
  if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
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

# ---------------------------------------------------------------- workspaces
phase_workspaces() {
  log "Bots root $BOTS_ROOT and SSH client config"
  local unit
  unit=$(systemd-escape -p --suffix=mount "$BOTS_ROOT")
  as_user install -d -m 0700 "$DSH_HOME/.dsh" "$BOTS_ROOT" "$DSH_HOME/.ssh" "$DSH_HOME/.dsh/bots-vm" "$DSH_HOME/.dsh/bots-vm/ssh"
  if [[ $OS_FAMILY == nixos ]]; then
    systemctl is-enabled --quiet "$unit" ||
      fail "The bind mount of $BOTS_ROOT ($unit) is missing." "Rebuild NixOS with dsh-bots.nix."
  else
    cat >"/etc/systemd/system/$unit" <<EOF
# Managed by dsh-bots infra/vm/host-setup.sh
[Unit]
Description=dsh-bots: bots' shared workspaces (nosuid,nodev,nosymfollow)
Before=incus.service

[Mount]
What=$BOTS_ROOT
Where=$BOTS_ROOT
Type=none
Options=bind,nosuid,nodev,nosymfollow

[Install]
WantedBy=local-fs.target
EOF
    install -d -m 0755 /etc/systemd/system/incus.service.d
    cat >/etc/systemd/system/incus.service.d/50-dsh-bots-root.conf <<EOF
# Managed by dsh-bots infra/vm/host-setup.sh
# Bot VMs autostart with incusd and share directories under $BOTS_ROOT:
# never before that mount (nosuid,nodev,nosymfollow) is in place.
[Unit]
RequiresMountsFor=$BOTS_ROOT
EOF
    systemctl daemon-reload
    systemctl enable "$unit" >/dev/null 2>&1
  fi
  if findmnt -n -M "$BOTS_ROOT" >/dev/null 2>&1; then
    local opts
    opts=$(findmnt -n -o OPTIONS -M "$BOTS_ROOT" | tail -n1)
    [[ ,$opts, == *,nosuid,* && ,$opts, == *,nodev,* && ,$opts, == *,nosymfollow,* ]] || systemctl restart "$unit"
  fi
  systemctl start "$unit"

  # dsh-bot-vm writes one ssh config per bot VM under ~/.dsh/bots-vm/ssh and checks it is read.
  local cfg=$DSH_HOME/.ssh/config include='Include ~/.dsh/bots-vm/ssh/*.conf' tmp
  if ! { [[ -f $cfg ]] && grep -qxF "$include" "$cfg"; }; then
    tmp=$(mktemp)
    if [[ -f $cfg ]]; then
      cp -p "$cfg" "$cfg.bak.$(date +%Y%m%d%H%M%S)"
      { echo "$include"; echo; cat "$cfg"; } >"$tmp"
    else
      echo "$include" >"$tmp"
    fi
    install -m 0600 -o "$DSH_USER" -g "$DSH_GROUP" "$tmp" "$cfg"
    rm -f "$tmp"
  fi
}

(($#)) || fail "No phase given." "Run: host-setup.sh packages|incus|firewall|workspaces|all"
for phase in "$@"; do
  case $phase in
    packages) phase_packages ;;
    incus) phase_incus ;;
    firewall) phase_firewall ;;
    workspaces) phase_workspaces ;;
    all) phase_packages; phase_incus; phase_firewall; phase_workspaces ;;
    *) fail "Unknown phase $phase." "Run: host-setup.sh packages|incus|firewall|workspaces|all" ;;
  esac
done
