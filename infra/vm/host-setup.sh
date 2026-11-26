#!/usr/bin/env bash
set -eEuo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
# shellcheck source=../incus/objects.sh
. "$HERE/../incus/objects.sh"
trap on_error ERR

POOL=${POOL:-dsh}
POOL_SIZE=${POOL_SIZE:-80GiB}
NET=${NET:-dshbr0}
NET_CIDR=${NET_CIDR:-10.240.80.1/24}
ACL=${ACL:-dsh-bot-egress}
PROJECT=${PROJECT:-dsh-bots}
HTTPS_PORT=${HTTPS_PORT:-8443}
HTTPS_SCOPE=${HTTPS_SCOPE:-all}
CLIENT_NAME=${CLIENT_NAME:-dsh-bots}
REPLACE_CLIENT=${REPLACE_CLIENT:-}
OWNER=${OWNER:-}
GW_IP=${NET_CIDR%/*}
MIN_INCUS=6.0.4
MIN_FREE_GIB=20
INCUS_DEFAULT_PORT=8443
ZABBLY_FINGERPRINT=4EFC590696CB15B87C73A3AD82CC8797C838DCFD
MODULES_FILE=$SYSROOT/etc/modules-load.d/dsh-bots.conf
DOCKER_UNIT=$SYSROOT/etc/systemd/system/dsh-bots-docker-forward.service
ZABBLY_KEY=$SYSROOT/etc/apt/keyrings/zabbly.asc
ZABBLY_LIST=$SYSROOT/etc/apt/sources.list.d/zabbly-incus-lts-6.0.sources

usage() {
  printf 'host-setup.sh: %s\n' "$1" >&2
  printf 'Usage: host-setup.sh [--events] <phase>...\n  phases: preflight packages incus firewall https token, all (= packages incus firewall)\n' >&2
  exit 2
}

require_root() {
  [[ $(id -u) == 0 ]] || fail not-root "The $EVENT_PHASE phase of host-setup.sh must run as root." "Run it with sudo."
}

incus_source() {
  case $OS_ID:$OS_VERSION in
    debian:12 | ubuntu:24.04) INCUS_SOURCE=zabbly ;;
    *) INCUS_SOURCE=distro ;;
  esac
}

valid_port() { [[ $1 =~ ^[1-9][0-9]{0,4}$ ]] && (($1 <= 65535)); }

port_listening() { [[ -n $(ss -ltnH "sport = :$1") ]]; }

port_of() {
  local port=${1##*:}
  [[ $1 == *:* && $port =~ ^[0-9]+$ ]] || port=$INCUS_DEFAULT_PORT
  printf '%s' "$port"
}

write_file() {
  local path=$1 content=$2
  [[ -f $path && $(<"$path") == "$content" ]] && return 0
  printf '%s\n' "$content" >"$path.tmp"
  mv "$path.tmp" "$path"
  mark_changed
}

enable_unit() { systemctl is-enabled --quiet "$1" || { systemctl enable "$1"; mark_changed; }; }
start_unit() { systemctl is-active --quiet "$1" || { systemctl start "$1"; mark_changed; }; }

ufw_active() { command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; }
firewalld_running() { command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; }

ufw_allow() {
  local before
  before=$(ufw status)
  ufw "$@" >/dev/null
  [[ $(ufw status) == "$before" ]] || mark_changed
}

phase_preflight() {
  log "Preflight"
  local arch
  arch=$(uname -m)
  if [[ $arch == x86_64 ]]; then check arch ok "$arch"; else
    check arch failed "$arch" arch-unsupported "This is a $arch machine; dsh-bots VM hosts are x86_64 only." "Use an x86_64 machine as the VM host."
  fi

  detect_os
  if [[ $OS_FAMILY != unsupported ]]; then check os ok "$OS_NAME"
  elif ((OS_DSH_HOST_ONLY)); then
    check os failed "${OS_NAME:-$OS_ID}" os-dsh-host-only "This machine cannot be a VM host: $OS_WHY." "Build the VM host on another machine."
  else
    check os failed "${OS_NAME:-$OS_ID}" os-unsupported "This machine cannot be a VM host: $OS_WHY." "Use one of the VM hosts: Debian 13 or 12, Ubuntu 24.04, Fedora 42+."
  fi

  if [[ -e $SYSROOT/dev/kvm ]]; then check kvm ok /dev/kvm; else
    check kvm failed absent kvm-missing "/dev/kvm is missing: KVM is not available." \
      "Turn on virtualization (VT-x / AMD-V) in the firmware, or nested virtualization for a VM."
  fi

  if [[ -d $SYSROOT/run/systemd/system ]]; then check init ok systemd; else
    check init failed other systemd-missing "systemd is not the init system." "Use a VM host that runs systemd (it runs Incus)."
  fi

  local free
  free=$(df -Pk "$SYSROOT/var/lib" | awk 'NR == 2 {print int($4 / 1048576)}')
  if ((free >= MIN_FREE_GIB)); then check disk ok "$free GiB free"; else
    check disk failed "$free GiB free" disk-low "/var/lib has $free GiB free; the base image and bot VMs need at least $MIN_FREE_GIB GiB." "Free space on that file system."
  fi

  if [[ $(id -u) == 0 ]]; then check privilege ok root
  elif ! command -v sudo >/dev/null; then
    check privilege failed none sudo-missing "sudo is not installed and this user is not root." "Install sudo and allow this user to use it, or connect as root."
  elif sudo -n true 2>/dev/null; then check privilege ok sudo-without-password
  else check privilege ok sudo-with-password
  fi

  local incus_version=""
  if command -v incus >/dev/null; then
    incus_version=$(incus --version)
    check incus warning "$incus_version" incus-present "Incus $incus_version is already installed; dsh-bots uses it as it is."
  else
    check incus ok absent
  fi

  incus_source
  if [[ $OS_FAMILY != unsupported && $INCUS_SOURCE == zabbly ]]; then
    check third-party warning zabbly consent-needed "Incus for $OS_NAME comes from the third-party repository Zabbly (pkgs.zabbly.com, the Incus maintainers' packages)."
  else
    check third-party ok none
  fi

  if ! port_listening "$HTTPS_PORT"; then check port ok "$HTTPS_PORT"
  elif [[ -n $incus_version ]]; then
    check port warning "$HTTPS_PORT" port-maybe-incus "Port $HTTPS_PORT is in use; if Incus listens there, dsh-bots uses it as it is." "If another program uses it, choose another HTTPS port."
  else
    check port failed "$HTTPS_PORT" port-in-use "Port $HTTPS_PORT is in use by another program." "Choose another HTTPS port, or free it (ss -ltnp shows what listens there)."
  fi
}

need_third_party() {
  [[ ${DSH_BOTS_THIRD_PARTY:-} == yes ]] ||
    fail third-party-refused "Incus for $OS_NAME comes from the third-party repository $1." "Allow it with DSH_BOTS_THIRD_PARTY=yes."
}

zabbly_source() {
  local fingerprints
  if [[ ! -s $ZABBLY_KEY ]]; then
    install -d -m 0755 "${ZABBLY_KEY%/*}"
    curl -fsSL https://pkgs.zabbly.com/key.asc -o "$ZABBLY_KEY.tmp"
    fingerprints=$(gpg --show-keys --with-colons "$ZABBLY_KEY.tmp")
    grep -q "^fpr:::::::::$ZABBLY_FINGERPRINT:" <<<"$fingerprints" ||
      { rm -f "$ZABBLY_KEY.tmp"; fail zabbly-key-mismatch "The Zabbly signing key has an unexpected fingerprint." "Check https://github.com/zabbly/incus and your network."; }
    mv "$ZABBLY_KEY.tmp" "$ZABBLY_KEY"
    mark_changed
  fi
  if [[ ! -f $ZABBLY_LIST ]]; then
    printf 'Enabled: yes\nTypes: deb\nURIs: https://pkgs.zabbly.com/incus/lts-6.0\nSuites: %s\nComponents: main\nArchitectures: amd64\nSigned-By: %s\n' \
      "$OS_CODENAME" "/etc/apt/keyrings/zabbly.asc" >"$ZABBLY_LIST"
    apt-get update -q
    mark_changed
  fi
}

apt_install() {
  local missing=() p
  for p in "$@"; do
    [[ $(dpkg-query -W -f='${Status}' "$p" 2>/dev/null) == *"install ok installed"* ]] || missing+=("$p")
  done
  ((${#missing[@]})) || return 0
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
  mark_changed
}

dnf_install() {
  local missing=() p
  for p in "$@"; do
    rpm -q "$p" >/dev/null 2>&1 || missing+=("$p")
  done
  ((${#missing[@]})) || return 0
  dnf install -y "${missing[@]}"
  mark_changed
}

phase_packages() {
  require_root
  detect_os
  [[ $OS_FAMILY != unsupported ]] || fail os-unsupported "This machine cannot be a VM host: $OS_WHY." "Use one of the VM hosts in the README."
  fact os "$OS_NAME"
  incus_source
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
      dnf_install incus incus-agent qemu-system-x86-core edk2-ovmf swtpm btrfs-progs e2fsprogs nftables zstd
      ;;
  esac
  write_file "$MODULES_FILE" "# Managed by dsh-bots infra/vm/host-setup.sh"$'\n'"vhost_vsock"
  if [[ ! -d $SYSROOT/sys/module/vhost_vsock ]]; then
    modprobe vhost_vsock ||
      fail module-missing "Loading the kernel module vhost_vsock failed." "Check that the running kernel ships it (modinfo vhost_vsock)."
    mark_changed
  fi
  enable_unit incus.socket
  start_unit incus.socket
  enable_unit incus.service
  start_unit incus.service
  incus admin waitready --timeout=120
  local versions version info
  versions=$(incus version)
  version=$(awk -F': *' '/^Server version/ {print $2}' <<<"$versions")
  version_ge "$version" "$MIN_INCUS" ||
    fail incus-too-old "Incus $version is older than $MIN_INCUS." "Upgrade Incus to $MIN_INCUS or newer."
  info=$(incus info)
  awk '/^  driver:/' <<<"$info" | grep -qw qemu ||
    fail no-vm-driver "This Incus cannot run virtual machines (no qemu driver)." "Check /dev/kvm and QEMU; journalctl -u incus says why."
  fact incus-version "$version"
  note "Incus $version"
}

foreign_resources() {
  local instances pools pool volumes name type owner
  instances=$(incus list --project "$PROJECT" -f csv -c n)
  while IFS= read -r name; do
    [[ -n $name ]] || continue
    owner=$(incus config get --project "$PROJECT" "$name" user.dsh-bot.owner)
    [[ $owner == "$OWNER" ]] || printf 'instance %s\n' "$name"
  done <<<"$instances"
  pools=$(incus storage list -f csv -c n)
  while IFS= read -r pool; do
    [[ -n $pool ]] || continue
    volumes=$(incus storage volume list "$pool" --project "$PROJECT" -f csv -c tn)
    while IFS=, read -r type name; do
      [[ $type == custom ]] || continue
      owner=$(incus storage volume get --project "$PROJECT" "$pool" "custom/$name" user.dsh-bot.owner)
      [[ $owner == "$OWNER" ]] || printf 'volume %s/%s\n' "$pool" "$name"
    done <<<"$volumes"
  done <<<"$pools"
}

phase_incus() {
  require_root
  log "Incus objects"
  if [[ -n $OWNER ]] && incus project show "$PROJECT" >/dev/null 2>&1; then
    local foreign
    foreign=$(foreign_resources)
    [[ -z $foreign ]] || fail project-in-use "The project $PROJECT holds what another installation made: ${foreign//$'\n'/, }." \
      "Choose another project name, or delete them if nothing uses them."
  fi
  if ! incus storage show "$POOL" >/dev/null 2>&1; then
    incus storage create "$POOL" btrfs size="$POOL_SIZE"
    mark_changed
  fi
  ensure_egress_acl "$ACL" "$GW_IP"
  ensure_bridge "$NET" "$NET_CIDR" "$ACL"
  ensure_project "$PROJECT" "$POOL" "$NET" "$ACL"
  fact project "$PROJECT"
  fact pool "$POOL"
  fact network "$NET"
  fact egress-acl "$ACL"
  note "project $PROJECT (pool $POOL, network $NET)"
}

docker_unit_text() {
  cat <<EOF
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
ExecStart=/bin/sh -c '$1 -C DOCKER-USER -i $NET -j ACCEPT 2>/dev/null || $1 -I DOCKER-USER -i $NET -j ACCEPT'
ExecStart=/bin/sh -c '$1 -C DOCKER-USER -o $NET -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || $1 -I DOCKER-USER -o $NET -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'

[Install]
WantedBy=docker.service
EOF
}

docker_unit() {
  local iptables text
  iptables=$(command -v iptables)
  text=$(docker_unit_text "$iptables")
  if [[ -f $DOCKER_UNIT && $(<"$DOCKER_UNIT") == "$text" ]]; then
    start_unit dsh-bots-docker-forward.service
    return 0
  fi
  write_file "$DOCKER_UNIT" "$text"
  systemctl daemon-reload
  systemctl enable dsh-bots-docker-forward.service >/dev/null 2>&1
  systemctl restart dsh-bots-docker-forward.service
}

dropping_forward_chains() {
  nft list chains 2>/dev/null | awk '
    $1 == "table" { table = $2 " " $3 }
    $1 == "chain" { chain = $2 }
    /hook forward/ && /policy drop/ && table != "inet incus" { print table " " chain }'
}

phase_firewall() {
  require_root
  log "Firewall"
  local handled=()
  if ufw_active; then
    ufw_allow allow in on "$NET"
    ufw_allow route allow in on "$NET"
    ufw_allow route allow out on "$NET"
    handled+=("ufw")
  fi
  if firewalld_running; then
    if ! firewall-cmd --permanent --zone=trusted --query-interface="$NET" >/dev/null 2>&1; then
      firewall-cmd --permanent --zone=trusted --add-interface="$NET" >/dev/null
      firewall-cmd --reload >/dev/null
      mark_changed
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
  [[ -z $dropping ]] || fail firewall-drops "The firewall drops forwarded traffic (${dropping//$'\n'/, }), so bot VMs would have no network." \
    "Allow forwarding from and to $NET in that firewall, then run this again."
}

phase_https() {
  require_root
  log "HTTPS API"
  local address port
  address=$(incus config get core.https_address)
  if [[ -z $address ]]; then
    ! port_listening "$HTTPS_PORT" || fail port-in-use "Port $HTTPS_PORT is in use by another program, so Incus cannot listen there." \
      "Choose another HTTPS port, or free it (ss -ltnp shows what listens there)."
    case $HTTPS_SCOPE in
      loopback) address=127.0.0.1:$HTTPS_PORT ;;
      all) address=:$HTTPS_PORT ;;
    esac
    incus config set core.https_address="$address"
    mark_changed
  fi
  port=$(port_of "$address")
  if [[ $HTTPS_SCOPE == all ]]; then
    if ufw_active; then ufw_allow allow "$port/tcp"; fi
    if firewalld_running && ! firewall-cmd --permanent --query-port="$port/tcp" >/dev/null 2>&1; then
      firewall-cmd --permanent --add-port="$port/tcp" >/dev/null
      firewall-cmd --reload >/dev/null
      mark_changed
    fi
  fi
  local server fingerprint
  server=$(incus query /1.0)
  fingerprint=$(sed -n 's/^[[:space:]]*"certificate_fingerprint": "\([0-9a-f]\{64\}\)".*/\1/p' <<<"$server" | head -n1)
  [[ -n $fingerprint ]] || fail command-failed "Incus did not name its server certificate's fingerprint (incus query /1.0)." "Check that Incus runs and has a server certificate."
  fact https-address "$address"
  fact server-fingerprint "$fingerprint"
  note "listening on $address"
}

phase_token() {
  require_root
  log "Trust token"
  if [[ -n $REPLACE_CLIENT ]] && incus config trust show "$REPLACE_CLIENT" >/dev/null 2>&1; then
    incus config trust remove "$REPLACE_CLIENT"
  fi
  issue_token "$CLIENT_NAME" "$PROJECT"
  mark_changed
  if ((EVENTS)); then
    event token "token=$TOKEN"
  elif [[ -n ${DSH_BOTS_TOKEN_FILE:-} ]]; then
    printf '%s\n' "$TOKEN" >"$DSH_BOTS_TOKEN_FILE"
  else
    printf '%s\n' "$TOKEN"
  fi
  note "token for $CLIENT_NAME"
}

WITH_EVENTS=0
if [[ ${1:-} == --events ]]; then
  WITH_EVENTS=1
  shift
fi
(($#)) || usage "no phase given"
SELECTED=()
for phase in "$@"; do
  case $phase in
    all) SELECTED+=(packages incus firewall) ;;
    preflight | packages | incus | firewall | https | token) SELECTED+=("$phase") ;;
    *) usage "unknown phase $phase" ;;
  esac
done
[[ $HTTPS_SCOPE == loopback || $HTTPS_SCOPE == all ]] || usage "HTTPS_SCOPE is $HTTPS_SCOPE, not loopback or all"
valid_port "$HTTPS_PORT" || usage "HTTPS_PORT is $HTTPS_PORT, not a port"
[[ -z $REPLACE_CLIENT || $REPLACE_CLIENT =~ ^[0-9a-f]{12,64}$ ]] || usage "REPLACE_CLIENT is not a certificate fingerprint"
[[ -z $OWNER || $OWNER =~ ^[0-9a-f]{16,64}$ ]] || usage "OWNER is not 16 to 64 lowercase hex digits"

((!WITH_EVENTS)) || events_start
for phase in "${SELECTED[@]}"; do
  phase_begin "$phase"
  "phase_$phase"
  phase_end
done
events_end
