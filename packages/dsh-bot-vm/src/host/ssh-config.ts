export interface SshHostEntry {
  readonly alias: string
  readonly proxyCommand: string
  readonly user: string
  readonly identityFile: string
  readonly knownHostsFile: string
}

export const MANAGED_HEADER = "# Managed by @1outres/dsh-bot-vm; rewritten on every ensure."

function configValue(value: string): string {
  if (/["\r\n\0]/.test(value))
    throw new Error(`unsupported character in ssh config value: ${value}`)
  return /\s/.test(value) ? `"${value}"` : value
}

function configPath(value: string): string {
  return configValue(value.replaceAll("%", "%%"))
}

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

export function knownHostsText(alias: string, hostPublicKey: string): string {
  const [type, key] = hostPublicKey.trim().split(/\s+/)
  if (type === undefined || key === undefined) throw new Error("malformed host public key")
  return `${alias} ${type} ${key}\n`
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
