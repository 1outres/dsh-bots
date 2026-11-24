/** cloud-init user-data for a bot VM's first boot. */
import { posix } from "node:path"

export interface UserDataInput {
  /** Unprivileged guest user dsh-ssh logs in as (exists in the base image). */
  readonly user: string
  /** Guest directory that is the cwd of every bot session, e.g. /home/bot/workspace. */
  readonly workspace: string
  /** The bot's SSH client public key (one line). */
  readonly authorizedKey: string
  /** Pre-generated ed25519 host key pair, pinned in the Host's known_hosts. */
  readonly hostPrivateKey: string
  readonly hostPublicKey: string
}

/** Written by cloud-init at the end of a boot; ensure waits for it (and so for the keys on disk). */
export const BOOT_FINISHED = "/var/lib/cloud/instance/boot-finished"

/**
 * Runs once, after the user exists: the base image already has the default
 * workspace; another configured one is created for the user (new parents
 * root 0755; an existing directory is left as it is). Positional arguments,
 * so the path needs no quoting: $1 workspace, $2 user.
 */
const WORKSPACE_SCRIPT = '[ -d "$1" ] || install -d -o "$2" -g "$2" -m 0755 "$1"'

/** A canonical absolute path: no `.`/`..`/empty segments, no trailing slash, not `/`. */
export function isCanonicalPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    path !== "/" &&
    !/[\0\r\n]/.test(path) &&
    posix.normalize(path) === path &&
    !path.endsWith("/")
  )
}

/** JSON with every non-ASCII character escaped, so the YAML stays plain ASCII. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )
}

/**
 * The user-data document. JSON is valid YAML, so values never need YAML
 * escaping; the `#cloud-config` header selects the cloud-config format.
 */
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
    runcmd: [
      ["sh", "-c", WORKSPACE_SCRIPT, "sh", input.workspace, input.user],
      // Make the first boot's writes (host keys, user) durable before ensure resolves.
      ["sync"],
    ],
  }
  return `#cloud-config\n${asciiJson(document)}\n`
}
