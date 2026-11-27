# Proxmox VE as the VM host

dsh-bots can put its bot VMs on an existing Proxmox VE 9 node, with an API token limited to one pool. The plugin never logs in to the node over SSH: everything goes through the API, and the DSH host connects to each bot VM's SSH at the VM's address.

## What the administrator runs

As root on the node (`--cpus` and `--memory` are the share all bot VMs may use together):

```sh
curl -fsSL https://codeload.github.com/1outres/dsh-bots/tar.gz/v<version> | tar -xz --strip-components=1 dsh-bots-<version>/infra
infra/proxmox/create-pool.sh --cpus 8 --memory 16 --enable-firewall
```

`create-pool.sh` is idempotent and makes or updates:

| what                | default                                                                        |                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage             | `dshbots` (a directory storage at `/var/lib/dsh-bots` if missing)              | content `images,import,iso`: the bots' disks, the base image's qcow2, the cloud-init ISO images                                                                                                                                                                   |
| pool                | `dsh-bots`                                                                     | the storage is a member; the comment declares the limits (`dsh-bots: cpus=8 memory=16GiB`), which the plugin reads for its sizes                                                                                                                                  |
| role                | `DshBots`                                                                      | `VM.Allocate VM.Audit VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Disk VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options VM.PowerMgmt VM.GuestAgent.Audit Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Pool.Audit` |
| user and token      | `dsh-bots@pve`, `dsh-bots@pve!plugin` (privilege separation)                   | the secret is printed once; `--new-token` replaces it                                                                                                                                                                                                             |
| ACL                 | `DshBots` on `/pool/dsh-bots`, `PVESDNUser` on `/sdn/zones/localnetwork/vmbr0` | for the user and the token (a privilege-separated token gets the intersection)                                                                                                                                                                                    |
| datacenter firewall | on with `--enable-firewall`, otherwise a warning                               | the VMs' firewall rules only work with it on; check the node's own rules first                                                                                                                                                                                    |

It prints the values to enter in DSH: **dsh-bots settings** → **VM host** → **Use an existing server** → **Proxmox** (API address, the certificate's SHA-256 to compare, token ID and secret, node, pool, storage, bridge).

## Network

- The bridge's network must be routed to the DSH host (the same L2, a route, or a VPN): the plugin reads each VM's IPv4 address from the QEMU guest agent and connects to its port 22.
- Each bot VM gets its own firewall (rewritten whenever the VM is made): in only TCP 22 from the address the VMs see the DSH host at (the settings fill in the address the DSH host reaches the API from); out reject `0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.168.0.0/16 198.18.0.0/15 224.0.0.0/3` and all IPv6, the same ranges as the Incus ACL; IP filtering pins the VM to the address the guest agent reported.
- The VMs get the DNS servers named in the settings (default `1.1.1.1 9.9.9.9`) in addition to the DHCP ones; a private one named there is let through on port 53, other private resolvers stay rejected by the egress rules.
- The token can change its own VMs' firewall. If that matters, filter the bridge's traffic outside Proxmox as well. The plugin measures from inside each VM whether private networks are reachable and shows it under **Network isolation**.

## What the plugin makes in the pool

- A template per base image (`dsh-bots-image-<fingerprint>`), from the image's qcow2 uploaded as `import` content; bot VMs are linked clones of it. An old template goes when its last clone goes.
- A bot VM per bot (`dsh-bot-<id>`), with a NoCloud ISO (`dsh-bots-seed-<vm>.iso`) as its first-boot cloud-init. The ISO is overwritten without secrets and detached after the first boot.
- One VM that never starts (`dsh-bots-volumes-<owner>`) owns the bots' workspace disks, so a workspace outlives its bot VM. Do not start or delete it.
- Notes on these VMs carry a `dsh-bots-meta:` line the plugin reads; do not edit it.

## Clean up

The token cannot delete files from the storage. Over time the administrator may remove:

- old `import` files (`dsh-bots-<fingerprint>.qcow2`, one per base image) once no template uses them,
- `dsh-bots-seed-*.iso` of bots that no longer exist (they hold no secrets),
- disks allocated for a VM id that does not exist (`pvesm list dshbots`).

To stop: remove the pool's VMs, then `pveum user token remove dsh-bots@pve plugin`, the user, the role, the pool and the storage.
