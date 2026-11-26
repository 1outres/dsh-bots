#!/usr/bin/env bash
set -euo pipefail
PROJECT=pve-spike POOL=pvespike NET=pvespk0 VM=pve1
incus storage create "$POOL" btrfs size=70GiB
incus network create "$NET" ipv4.address=10.250.77.1/24 ipv4.nat=true ipv4.dhcp.ranges=10.250.77.100-10.250.77.200 ipv6.address=none
incus project create "$PROJECT" -c features.images=true -c features.profiles=true -c features.storage.volumes=true -c features.networks=false
incus init images:debian/13 "$VM" --vm --project "$PROJECT" --no-profiles \
  -c limits.cpu=6 -c limits.memory=12GiB -c security.secureboot=false \
  -d root,size=60GiB -s "$POOL" \
  -n "$NET"
incus config device set "$VM" eth0 ipv4.address=10.250.77.10 --project "$PROJECT"
incus start "$VM" --project "$PROJECT"
