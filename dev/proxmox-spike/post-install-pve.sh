#!/usr/bin/env bash
set -euo pipefail
IP=10.250.77.10 GW=10.250.77.1 NIC=enp5s0
while pgrep -f "apt-get|dpkg" >/dev/null; do sleep 5; done
export DEBIAN_FRONTEND=noninteractive
dpkg --configure -a
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
rm -f /etc/systemd/network/*.network /etc/netplan/*.yaml
systemctl disable systemd-networkd.service systemd-networkd.socket systemd-resolved.service 2>/dev/null || true
rm -f /etc/resolv.conf; echo "nameserver $GW" >/etc/resolv.conf
echo post-done >/root/post-install.done
systemctl reboot
