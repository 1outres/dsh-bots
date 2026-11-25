/** OpenSSH client files for one bot VM: its config (`ssh -F`) and known_hosts line. */

export interface SshHostEntry {
  /** Host alias dsh-ssh connects to, e.g. "dsh-bot-1a2b3c4d". */
  readonly alias: string
  /** Command that relays stdin/stdout to the guest's sshd (src/host/guest-transport.ts). */
  readonly proxyCommand: string
  readonly user: string
  readonly identityFile: string
  readonly knownHostsFile: string
}

/** First line of every config this package writes; only such files are ever deleted. */
export const MANAGED_HEADER = "# Managed by @1outres/dsh-bot-vm; rewritten on every ensure."

/** OpenSSH config values may not carry these; paths with spaces are quoted. */
function configValue(value: string): string {
  if (/["\r\n\0]/.test(value))
    throw new Error(`unsupported character in ssh config value: ${value}`)
  return /\s/.test(value) ? `"${value}"` : value
}

/** A path for a directive that expands `%` tokens (IdentityFile, UserKnownHostsFile). */
function configPath(value: string): string {
  return configValue(value.replaceAll("%", "%%"))
}

/**
 * The bot's whole OpenSSH client config, passed with `ssh -F` (so neither
 * ~/.ssh/config nor /etc/ssh/ssh_config is read). The host key is pinned
 * under the alias (HostKeyAlias), and only the pinned ed25519 key type is
 * offered.
 */
export function sshConfigText(entry: SshHostEntry): string {
  return [
    MANAGED_HEADER,
    `Host ${configValue(entry.alias)}`,
    `  ProxyCommand ${entry.proxyCommand}`,
    "  ProxyUseFdpass no",
    "  CheckHostIP no",
    `  User ${configValue(entry.user)}`,
    `  IdentityFile ${configPath(entry.identityFile)}`,
    "  IdentitiesOnly yes",
    `  UserKnownHostsFile ${configPath(entry.knownHostsFile)}`,
    "  GlobalKnownHostsFile /dev/null",
    `  HostKeyAlias ${configValue(entry.alias)}`,
    "  HostKeyAlgorithms ssh-ed25519",
    "  StrictHostKeyChecking yes",
    "  UpdateHostKeys no",
    "  PasswordAuthentication no",
    "  KbdInteractiveAuthentication no",
    "  ForwardAgent no",
    "  ForwardX11 no",
    "",
  ].join("\n")
}

/** known_hosts line pinning the VM's pre-generated host key under the alias. */
export function knownHostsText(alias: string, hostPublicKey: string): string {
  const [type, key] = hostPublicKey.trim().split(/\s+/)
  if (type === undefined || key === undefined) throw new Error("malformed host public key")
  return `${alias} ${type} ${key}\n`
}

/** Single-quote a word for a POSIX shell (the remote login shell runs ssh commands). */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
