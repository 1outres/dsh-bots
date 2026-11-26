#!/usr/bin/env bash
set -euo pipefail
PROJECT=pve-spike POOL=pvespike NET=pvespk0 VM=pve1
incus delete --force "$VM" --project "$PROJECT"
incus image list --project "$PROJECT" -f csv -c f | while read -r fp; do incus image delete "$fp" --project "$PROJECT"; done
incus project delete "$PROJECT"
incus network delete "$NET"
incus storage delete "$POOL"
rm -rf /var/tmp/pve-spike /var/tmp/pve-spike-install.log
