#!/usr/bin/env bash
set -euo pipefail
POOL=dsh-bots STORE=dshbots DIR=/var/lib/dsh-bots USERID=dsh-bots@pve TOKEN=plugin ROLE=DshBots BRIDGE=vmbr0
PRIVS="VM.Allocate VM.Audit VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options VM.Console VM.PowerMgmt VM.GuestAgent.Audit Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Pool.Audit SDN.Use"
mkdir -p "$DIR"
pvesm add dir "$STORE" --path "$DIR" --content images,import,snippets --prune-backups keep-all=1
pveum pool add "$POOL" --comment "dsh-bots bot VMs"
pveum pool modify "$POOL" --storage "$STORE"
pveum role add "$ROLE" --privs "${PRIVS// /,}"
pveum user add "$USERID" --comment "dsh-bots plugin"
pveum user token add "$USERID" "$TOKEN" --privsep 1 --output-format json >/root/dsh-bots-token.json
for who in "$USERID" "$USERID!$TOKEN"; do
  if [[ $who == *"!"* ]]; then kind=--tokens; else kind=--users; fi
  pveum acl modify "/pool/$POOL" --roles "$ROLE" "$kind" "$who"
  pveum acl modify "/sdn/zones/localnetwork/$BRIDGE" --roles PVESDNUser "$kind" "$who"
done
cat /root/dsh-bots-token.json
openssl x509 -in /etc/pve/local/pve-ssl.pem -noout -fingerprint -sha256
