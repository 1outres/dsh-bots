import type { SshTarget } from "@1outres/dsh-bot-core"

export const VM_HOST_ALIAS = "dsh-bots-vm-host"

export interface SetupSshPaths {
  readonly dir: string
  readonly identity: string
  readonly publicKey: string
  readonly knownHosts: string
  readonly config: string
}

export function setupSshPaths(stateDir: string): SetupSshPaths {
  const dir = `${stateDir}/setup/ssh`
  return {
    dir,
    identity: `${dir}/id_ed25519`,
    publicKey: `${dir}/id_ed25519.pub`,
    knownHosts: `${dir}/known_hosts`,
    config: `${dir}/config`,
  }
}

export interface ScannedHostKey {
  readonly type: string
  readonly line: string
}

const HOST = /^[A-Za-z0-9.-]+$|^\[?[0-9a-fA-F:]+\]?$/
const USER = /^[a-z_][a-z0-9_.-]{0,31}$/i
const KEY_LINE = /^([a-z0-9@.-]+) ([A-Za-z0-9+/]+=*)$/

export function parseSshTarget(target: SshTarget): SshTarget {
  const host = target.host.trim()
  const user = target.user.trim()
  if (!HOST.test(host)) throw new Error(`"${target.host}" is not a host name or address`)
  if (!USER.test(user)) throw new Error(`"${target.user}" is not a user name`)
  if (!Number.isSafeInteger(target.port) || target.port < 1 || target.port > 65535) {
    throw new Error(`${target.port} is not a port`)
  }
  return { host: host.replace(/^\[(.*)\]$/, "$1"), port: target.port, user }
}

export function parseKeyscan(output: string): readonly ScannedHostKey[] {
  const keys = new Map<string, ScannedHostKey>()
  for (const raw of output.split("\n")) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#")) continue
    const [, type, body] = line.split(/\s+/)
    if (type === undefined || body === undefined) continue
    const key = `${type} ${body}`
    if (KEY_LINE.test(key)) keys.set(key, { type, line: key })
  }
  return [...keys.values()]
}

export function hostKeyLine(value: string): string {
  const line = value.trim()
  if (!KEY_LINE.test(line)) throw new Error('the host key is not "<type> <base64>"')
  return line
}

function configValue(value: string): string {
  if (/["\r\n\0\s]/.test(value))
    throw new Error(`unsupported character in ssh config value: ${value}`)
  return value
}

const configPath = (value: string) => {
  if (/["\r\n\0]/.test(value)) throw new Error(`unsupported character in ssh config path: ${value}`)
  const escaped = value.replaceAll("%", "%%")
  return /\s/.test(escaped) ? `"${escaped}"` : escaped
}

export function setupSshConfigText(
  paths: SetupSshPaths,
  target: SshTarget,
  keyType: string,
): string {
  return [
    "# Managed by @1outres/dsh-bot-vm; rewritten when the VM host to build is chosen.",
    `Host ${VM_HOST_ALIAS}`,
    `  HostName ${configValue(target.host)}`,
    `  Port ${target.port}`,
    `  User ${configValue(target.user)}`,
    `  IdentityFile ${configPath(paths.identity)}`,
    "  IdentitiesOnly yes",
    `  UserKnownHostsFile ${configPath(paths.knownHosts)}`,
    "  GlobalKnownHostsFile /dev/null",
    `  HostKeyAlias ${VM_HOST_ALIAS}`,
    `  HostKeyAlgorithms ${configValue(keyType)}`,
    "  StrictHostKeyChecking yes",
    "  UpdateHostKeys no",
    "  CheckHostIP no",
    "  BatchMode yes",
    "  PasswordAuthentication no",
    "  KbdInteractiveAuthentication no",
    "  ForwardAgent no",
    "  ForwardX11 no",
    "  ClearAllForwardings yes",
    "  ConnectTimeout 20",
    "  ServerAliveInterval 15",
    "  ServerAliveCountMax 4",
    "",
  ].join("\n")
}

export const setupKnownHostsText = (hostKey: string) => `${VM_HOST_ALIAS} ${hostKeyLine(hostKey)}\n`

export function authorizedKeysLine(publicKey: string): string {
  const [type, body, ...comment] = publicKey.trim().split(/\s+/)
  if (type !== "ssh-ed25519" || body === undefined)
    throw new Error("the setup SSH key is not an ed25519 public key")
  return ["restrict", type, body, ...comment].join(" ")
}

export function publicKeyBody(publicKey: string): string {
  const body = publicKey.trim().split(/\s+/)[1]
  if (body === undefined || !/^[A-Za-z0-9+/]+=*$/.test(body))
    throw new Error("the setup SSH public key is malformed")
  return body
}

export function removeAuthorizedKeyScript(body: string): string {
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error("the setup SSH public key is malformed")
  return [
    "set -eu",
    'f="$HOME/.ssh/authorized_keys"',
    '[ -f "$f" ] || exit 0',
    't=$(mktemp "$f.XXXXXX")',
    `awk -v key='${body}' '{ for (i = 1; i <= NF; i++) if ($i == key) next; print }' "$f" > "$t"`,
    'chmod --reference="$f" "$t" 2>/dev/null || chmod 600 "$t"',
    'mv -f "$t" "$f"',
  ].join("; ")
}

export const manualRemovalCommand = (body: string) =>
  `awk -v key='${body}' '{ for (i = 1; i <= NF; i++) if ($i == key) next; print }' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.new && mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys`
