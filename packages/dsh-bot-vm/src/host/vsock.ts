/**
 * The ssh ProxyCommand that reaches a bot VM's sshd over AF_VSOCK: this
 * package's `vsock-proxy.js` (run by the Host's Node) looks the VM's current
 * vsock id up in Incus on every connection and relays stdin/stdout through
 * `socat` (VSOCK-CONNECT, socat >= 1.7.4). One mechanism on every Host; no
 * systemd-ssh-proxy, no fd passing.
 */
import type { IncusInstance } from "./incus"

/** Where the proxy runs from and which Incus it asks. */
export interface VsockProxy {
  /** Absolute Node executable (the Host's DSH runs on it). */
  readonly node: string
  /** Absolute path of this package's lib/vsock-proxy.js. */
  readonly script: string
  /** Incus API socket. */
  readonly socket: string
  readonly project: string
}

/** What one proxy invocation needs, as its command line carries it. */
export interface VsockProxyArgs {
  readonly socket: string
  readonly project: string
  readonly instance: string
  readonly port: number
  /** Absolute socat executable. */
  readonly socat: string
}

export const SSH_PORT = 22

const SAFE_WORD = /^[A-Za-z0-9_/.,:@=+-]+$/
const OPTIONS = ["socket", "project", "instance", "port", "socat"] as const

/** One shell word; quoted only when it needs to be. */
function word(value: string): string {
  if (/[\0\r\n%]/.test(value)) throw new Error(`unsupported character in proxy command: ${value}`)
  return SAFE_WORD.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/** The ProxyCommand line of one instance (ssh runs it with the user's shell). */
export function proxyCommandOf(proxy: VsockProxy, socat: string, instance: string): string {
  const args: VsockProxyArgs = {
    socket: proxy.socket,
    project: proxy.project,
    instance,
    port: SSH_PORT,
    socat,
  }
  return [proxy.node, proxy.script, ...OPTIONS.flatMap((key) => [`--${key}`, String(args[key])])]
    .map(word)
    .join(" ")
}

/** The proxy's own arguments. @throws on anything else. */
export function parseProxyArgs(argv: readonly string[]): VsockProxyArgs {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "") ?? ""
    const value = argv[index + 1]
    if (!(OPTIONS as readonly string[]).includes(key) || value === undefined || values.has(key)) {
      throw new Error(
        `usage: vsock-proxy ${OPTIONS.map((option) => `--${option} <${option}>`).join(" ")}`,
      )
    }
    values.set(key, value)
  }
  const get = (key: (typeof OPTIONS)[number]) => {
    const value = values.get(key)
    if (value === undefined || value === "") throw new Error(`vsock-proxy: --${key} is required`)
    return value
  }
  const port = Number(get("port"))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`vsock-proxy: --port ${get("port")} is not a port`)
  }
  const socat = get("socat")
  if (!socat.startsWith("/")) throw new Error("vsock-proxy: --socat must be an absolute path")
  return {
    socket: get("socket"),
    project: get("project"),
    instance: get("instance"),
    port,
    socat,
  }
}

/** The instance's current vsock context id. @throws while it has none. */
export function vsockCidOf(instance: IncusInstance): number {
  const cid = Number(instance.config["volatile.vsock_id"])
  if (!Number.isInteger(cid) || cid <= 2) {
    throw new Error(
      `Incus instance "${instance.name}" has no vsock id (volatile.vsock_id); is it running?`,
    )
  }
  return cid
}

/** socat's arguments relaying stdin/stdout to the guest's port. */
export function socatArgs(cid: number, port: number): readonly string[] {
  return ["STDIO", `VSOCK-CONNECT:${cid}:${port}`]
}
