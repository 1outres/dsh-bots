#!/usr/bin/env bash
set -eEuo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=../vm/lib.sh
. "$HERE/../vm/lib.sh"
trap on_error ERR

MIN_PVE=9.0
CONTENT=(images import iso)
PRIVILEGES=(
  VM.Allocate VM.Audit VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Disk VM.Config.HWType
  VM.Config.Memory VM.Config.Network VM.Config.Options VM.PowerMgmt VM.GuestAgent.Audit
  Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Pool.Audit
)

usage() {
  cat <<EOF
Usage: create-pool.sh --cpus <n> --memory <GiB> [options]
Run as root on a Proxmox VE $MIN_PVE+ node. It prepares what a dsh-bots plugin needs and
prints an API token limited to it; paste the printed values in the dsh-bots settings
(VM host -> Use an existing server -> Proxmox).

  --cpus <n>            vCPUs all bot VMs may use together (written to the pool's comment)
  --memory <GiB>        memory all bot VMs may use together, in GiB
  --pool <name>         the pool bot VMs live in (default: dsh-bots)
  --storage <name>      the storage for their disks, imports and ISO images (default: dshbots);
                        it needs the content types images, import and iso
  --storage-path <dir>  create --storage as a directory storage here when it is missing
                        (default: /var/lib/dsh-bots)
  --bridge <name>       the bridge bot VMs attach to (default: vmbr0); route its network to
                        the DSH host, which reaches each VM's SSH directly
  --user <id>           the Proxmox user the token belongs to (default: dsh-bots@pve)
  --token <name>        the API token's name (default: plugin)
  --role <name>         the role granted on the pool (default: DshBots)
  --new-token           replace the token if it exists (its secret is shown only once)
  --enable-firewall     turn the datacenter firewall on if it is off (the bot VMs' egress
                        rules only work with it on)
EOF
}

CPUS="" MEMORY="" POOL=dsh-bots STORAGE=dshbots STORAGE_PATH=/var/lib/dsh-bots BRIDGE=vmbr0
USERID=dsh-bots@pve TOKEN=plugin ROLE=DshBots NEW_TOKEN=0 ENABLE_FIREWALL=0
while (($#)); do
  case $1 in
    --cpus) CPUS=${2:?--cpus needs a value}; shift ;;
    --memory) MEMORY=${2:?--memory needs a value}; shift ;;
    --pool) POOL=${2:?--pool needs a value}; shift ;;
    --storage) STORAGE=${2:?--storage needs a value}; shift ;;
    --storage-path) STORAGE_PATH=${2:?--storage-path needs a value}; shift ;;
    --bridge) BRIDGE=${2:?--bridge needs a value}; shift ;;
    --user) USERID=${2:?--user needs a value}; shift ;;
    --token) TOKEN=${2:?--token needs a value}; shift ;;
    --role) ROLE=${2:?--role needs a value}; shift ;;
    --new-token) NEW_TOKEN=1 ;;
    --enable-firewall) ENABLE_FIREWALL=1 ;;
    -h | --help) usage; exit 0 ;;
    *) fail usage "Unknown option $1." "Run create-pool.sh --help." ;;
  esac
  shift
done

[[ $CPUS =~ ^[1-9][0-9]*$ ]] || fail usage "--cpus is not a whole number." "Give the vCPUs all bot VMs may use together, e.g. --cpus 8."
[[ $MEMORY =~ ^[1-9][0-9]*$ ]] || fail usage "--memory is not a whole number of GiB." "Give the memory in GiB, e.g. --memory 16."
((EUID == 0)) || fail not-root "create-pool.sh changes the node's users, ACLs and storage." "Run it as root on the node."
for tool in pveum pvesm pvesh pvenode perl openssl; do
  command -v "$tool" >/dev/null || fail tool-missing "$tool is missing." "Run create-pool.sh on a Proxmox VE node."
done

json_field() {
  perl -MJSON::PP -e 'my $d = decode_json(join "", <STDIN>); for my $k (split /\./, $ARGV[0]) { $d = ref $d eq "HASH" ? $d->{$k} : undef } print defined $d ? (ref $d ? encode_json($d) : $d) : ""' "$1"
}

exists() { pvesh get "$1" --output-format json >/dev/null 2>&1; }

log "Proxmox VE"
version=$(pvesh get /version --output-format json | json_field version)
version_ge "$version" "$MIN_PVE" || fail too-old "Proxmox VE ${version:-(unknown)} is older than $MIN_PVE." "Upgrade the node to Proxmox VE $MIN_PVE or newer."
NODE=$(hostname)
exists "/nodes/$NODE/network/$BRIDGE" || fail bridge-missing "The node has no bridge $BRIDGE." "Name one of the node's bridges with --bridge."
echo "node $NODE, Proxmox VE $version, bridge $BRIDGE"

log "Storage $STORAGE"
if ! exists "/storage/$STORAGE"; then
  mkdir -p "$STORAGE_PATH"
  pvesm add dir "$STORAGE" --path "$STORAGE_PATH" --content "$(IFS=,; echo "${CONTENT[*]}")" --prune-backups keep-all=1
  echo "created a directory storage at $STORAGE_PATH"
else
  current=$(pvesh get "/storage/$STORAGE" --output-format json | json_field content)
  wanted=$current
  for item in "${CONTENT[@]}"; do [[ ,$wanted, == *",$item,"* ]] || wanted=${wanted:+$wanted,}$item; done
  if [[ $wanted != "$current" ]]; then
    pvesm set "$STORAGE" --content "$wanted"
    echo "content: $current -> $wanted"
  else
    echo "content: $current"
  fi
fi

log "Pool $POOL"
exists "/pools/$POOL" || pveum pool add "$POOL"
pveum pool modify "$POOL" --comment "dsh-bots: cpus=$CPUS memory=${MEMORY}GiB"
members=$(pvesh get "/pools/$POOL" --output-format json | json_field members)
[[ $members == *"\"storage\":\"$STORAGE\""* ]] || pveum pool modify "$POOL" --storage "$STORAGE"
echo "limits: $CPUS vCPUs, $MEMORY GiB; storage $STORAGE is a member"

log "Role, user and token"
privileges=$(IFS=,; echo "${PRIVILEGES[*]}")
if exists "/access/roles/$ROLE"; then pveum role modify "$ROLE" --privs "$privileges"; else pveum role add "$ROLE" --privs "$privileges"; fi
exists "/access/users/$USERID" || pveum user add "$USERID" --comment "dsh-bots plugin"
SECRET=""
if exists "/access/users/$USERID/token/$TOKEN" && ((!NEW_TOKEN)); then
  echo "the token $USERID!$TOKEN exists; its secret is not shown again (use --new-token to replace it)"
else
  exists "/access/users/$USERID/token/$TOKEN" && pveum user token remove "$USERID" "$TOKEN"
  SECRET=$(pveum user token add "$USERID" "$TOKEN" --privsep 1 --comment "dsh-bots plugin" --output-format json | json_field value)
  [[ -n $SECRET ]] || fail token-missing "Proxmox printed no token secret." "Run create-pool.sh again with --new-token."
fi
for who in user token; do
  if [[ $who == user ]]; then flag=--users id=$USERID; else flag=--tokens id="$USERID!$TOKEN"; fi
  pveum acl modify "/pool/$POOL" --roles "$ROLE" "$flag" "$id"
  pveum acl modify "/sdn/zones/localnetwork/$BRIDGE" --roles PVESDNUser "$flag" "$id"
done
echo "$ROLE on /pool/$POOL and PVESDNUser on /sdn/zones/localnetwork/$BRIDGE for $USERID and its token"

log "Datacenter firewall"
enabled=$(pvesh get /cluster/firewall/options --output-format json | json_field enable)
if [[ $enabled == 1 ]]; then
  echo "on"
elif ((ENABLE_FIREWALL)); then
  pvesh set /cluster/firewall/options --enable 1
  echo "turned on"
else
  echo "warning: the datacenter firewall is off, so the bot VMs' firewall rules do nothing." >&2
  echo "  Check the node's own rules (the management IP set keeps 8006 and 22 open), then run" >&2
  echo "  pvesh set /cluster/firewall/options --enable 1   (or this script with --enable-firewall)" >&2
fi

certificate=/etc/pve/local/pveproxy-ssl.pem
[[ -e $certificate ]] || certificate=/etc/pve/local/pve-ssl.pem
fingerprint=$(openssl x509 -in "$certificate" -noout -fingerprint -sha256 | cut -d= -f2)

cat <<EOF

Enter these in the dsh-bots settings (VM host -> Use an existing server -> Proxmox):
  API address   https://<this node's address>:8006
  certificate   $fingerprint (compare it with the one the settings show)
  API token ID  $USERID!$TOKEN
  secret        ${SECRET:-(unchanged; shown when the token was made)}
  node          $NODE
  pool          $POOL
  storage       $STORAGE
  bridge        $BRIDGE
Each bot VM's firewall lets SSH in only from the DSH host's address and rejects private,
CGNAT, link-local and IPv6 destinations. The token may change those rules of its own VMs;
if that matters, also filter the bridge's traffic outside Proxmox.
EOF
