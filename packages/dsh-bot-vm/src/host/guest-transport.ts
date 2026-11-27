export interface GuestProxy {
  readonly node: string
  readonly script: string
  readonly socket: string
}

export const RELAY_READY = "ok"
export const RELAY_REFUSED = "error"

const SAFE_WORD = /^[A-Za-z0-9_/.,:@=+-]+$/
const INSTANCE = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/

function word(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error(`unsupported character in proxy command: ${value}`)
  const quoted = SAFE_WORD.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
  return quoted.replaceAll("%", "%%")
}

export function checkInstanceName(instance: string): string {
  if (!INSTANCE.test(instance)) throw new Error(`"${instance}" is not a bot VM name`)
  return instance
}

export function proxyCommandOf(proxy: GuestProxy, instance: string): string {
  return [proxy.node, proxy.script, proxy.socket, checkInstanceName(instance)].map(word).join(" ")
}

export const requestLine = (instance: string) => `${checkInstanceName(instance)}\n`

export const answerLine = (error?: string) =>
  error === undefined ? `${RELAY_READY}\n` : `${RELAY_REFUSED} ${error.replace(/[\r\n]+/g, " ")}\n`
