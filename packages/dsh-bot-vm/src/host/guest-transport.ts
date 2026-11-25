/**
 * How ssh reaches a bot VM's sshd (docs/specs/incus-endpoint.md §5.2, §10.1):
 * its ProxyCommand (this package's guest-proxy.js) connects to the relay this
 * DSH process listens on (`<stateDir>/run/guest.sock`, directory 0700), names
 * the instance, and from then on carries the bytes of `sshd -i`, which the
 * relay runs in the instance through Incus' exec API. Only the DSH process
 * talks to Incus: no Incus key is ever written to a file, and the ProxyCommand
 * carries no secret.
 */

/** Where the ProxyCommand runs from and which relay it reaches. */
export interface GuestProxy {
  /** Absolute Node executable (the Host's DSH runs on it). */
  readonly node: string
  /** Absolute path of this package's lib/guest-proxy.js. */
  readonly script: string
  /** The relay's Unix socket. */
  readonly socket: string
}

/** sshd in inetd mode, run as root: nothing listens in the VM. */
export const SSHD_COMMAND = ["/usr/sbin/sshd", "-i"] as const

/** The relay's answer before the stream starts. */
export const RELAY_READY = "ok"
export const RELAY_REFUSED = "error"

const SAFE_WORD = /^[A-Za-z0-9_/.,:@=+-]+$/
const INSTANCE = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/

/** One shell word, quoted only when needed; `%` is doubled for ssh's token expansion. */
function word(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error(`unsupported character in proxy command: ${value}`)
  const quoted = SAFE_WORD.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
  return quoted.replaceAll("%", "%%")
}

export function checkInstanceName(instance: string): string {
  if (!INSTANCE.test(instance)) throw new Error(`"${instance}" is not an Incus instance name`)
  return instance
}

/** The ProxyCommand line of one instance (ssh runs it with the user's shell). */
export function proxyCommandOf(proxy: GuestProxy, instance: string): string {
  return [proxy.node, proxy.script, proxy.socket, checkInstanceName(instance)].map(word).join(" ")
}

/** The proxy's first line to the relay. */
export const requestLine = (instance: string) => `${checkInstanceName(instance)}\n`

/** The relay's first line to the proxy. */
export const answerLine = (error?: string) =>
  error === undefined ? `${RELAY_READY}\n` : `${RELAY_REFUSED} ${error.replace(/[\r\n]+/g, " ")}\n`
