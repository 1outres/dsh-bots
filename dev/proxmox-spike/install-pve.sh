#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
IP=10.250.77.10 GW=10.250.77.1 NIC=enp5s0
hostnamectl set-hostname pve1
cat >/etc/hosts <<EOF
127.0.0.1 localhost
$IP pve1.spike.internal pve1
EOF
apt-get update -q
apt-get install -y -q curl ca-certificates
curl -fsSL -o /usr/share/keyrings/proxmox-archive-keyring.gpg https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg
cat >/etc/apt/sources.list.d/pve-install-repo.sources <<EOF
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF
apt-get update -q
apt-get full-upgrade -y -q
echo "postfix postfix/main_mailer_type select No configuration" | debconf-set-selections
apt-get install -y -q proxmox-ve postfix open-iscsi chrony
apt-get remove -y -q os-prober || true
cat >/etc/network/interfaces <<EOF
auto lo
iface lo inet loopback

iface $NIC inet manual

auto vmbr0
iface vmbr0 inet static
	address $IP/24
	gateway $GW
	bridge-ports $NIC
	bridge-stp off
	bridge-fd 0
EOF
echo "nameserver $GW" >/etc/resolv.conf.pve
systemctl disable systemd-networkd.service systemd-networkd.socket 2>/dev/null || true
rm -f /etc/systemd/network/*.network
echo done-install
