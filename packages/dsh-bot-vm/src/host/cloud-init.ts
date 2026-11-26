import { posix } from "node:path"

export interface UserDataInput {
  readonly workspaceDevice: string
  readonly user: string
  readonly workspace: string
  readonly authorizedKey: string
  readonly hostPrivateKey: string
  readonly hostPublicKey: string
}

export const BOOT_FINISHED = "/var/lib/cloud/instance/boot-finished"

export const WORKSPACE_MOUNT_OPTIONS =
  "defaults,x-systemd.makefs,x-systemd.growfs,x-systemd.device-timeout=60s"

const MOUNT_SCRIPT =
  'systemctl daemon-reload && systemctl start "$(systemd-escape --path --suffix=mount "$1")" && mountpoint -q "$1" && chown "$2:$2" "$1"'

export function isCanonicalPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    path !== "/" &&
    !/[\0\r\n]/.test(path) &&
    posix.normalize(path) === path &&
    !path.endsWith("/")
  )
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

export function userDataText(input: UserDataInput): string {
  if (!isCanonicalPath(input.workspace)) {
    throw new Error(`cloud-init: workspace must be a canonical absolute path: ${input.workspace}`)
  }
  const document = {
    users: [
      {
        name: input.user,
        lock_passwd: true,
        shell: "/bin/bash",
        ssh_authorized_keys: [input.authorizedKey.trim()],
      },
    ],
    disable_root: true,
    ssh_pwauth: false,
    ssh_deletekeys: true,
    ssh_genkeytypes: ["ed25519"],
    ssh_keys: {
      ed25519_private: input.hostPrivateKey,
      ed25519_public: input.hostPublicKey.trim(),
    },
    mounts: [[input.workspaceDevice, input.workspace, "ext4", WORKSPACE_MOUNT_OPTIONS, "0", "2"]],
    runcmd: [["sh", "-c", MOUNT_SCRIPT, "sh", input.workspace, input.user], ["sync"]],
  }
  return `#cloud-config\n${asciiJson(document)}\n`
}
