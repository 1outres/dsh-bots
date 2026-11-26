export const GMAIL_AUTHSERV_ID = "mx.google.com"

export interface AuthenticationResult {
  readonly method: string
  readonly result: string
  readonly properties: Readonly<Record<string, string>>
}

export interface AuthenticationResults {
  readonly authservId: string
  readonly results: readonly AuthenticationResult[]
}

function withoutComments(value: string): string {
  let depth = 0
  let quoted = false
  let out = ""
  for (const char of value) {
    if (char === '"' && depth === 0) quoted = !quoted
    if (!quoted && char === "(") {
      depth += 1
      continue
    }
    if (!quoted && char === ")" && depth > 0) {
      depth -= 1
      continue
    }
    if (depth === 0) out += char
  }
  return out
}

export function parseAuthenticationResults(header: string): AuthenticationResults | undefined {
  const [head, ...rest] = withoutComments(header.replace(/\r?\n[\t ]+/g, " ")).split(";")
  const authservId = head?.trim().split(/\s+/)[0]?.toLowerCase()
  if (authservId === undefined || authservId === "") return undefined
  const results: AuthenticationResult[] = []
  for (const part of rest) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    const [first, ...props] = tokens
    const methodResult = /^([a-z0-9._-]+)=([a-z]+)$/i.exec(first ?? "")
    if (methodResult === null) continue
    const properties: Record<string, string> = {}
    for (const token of props) {
      const property = /^([a-z0-9-]+\.[a-z0-9_.-]+)=(.+)$/i.exec(token)
      if (property === null) continue
      const key = (property[1] ?? "").toLowerCase()
      if (!(key in properties)) properties[key] = (property[2] ?? "").replace(/^"(.*)"$/, "$1")
    }
    results.push({
      method: (methodResult[1] ?? "").toLowerCase(),
      result: (methodResult[2] ?? "").toLowerCase(),
      properties,
    })
  }
  return { authservId, results }
}

const aligned = (signer: string, from: string) => from === signer || from.endsWith(`.${signer}`)

function dkimDomain(result: AuthenticationResult): string | undefined {
  const d = result.properties["header.d"]
  if (d !== undefined) return d.toLowerCase()
  const i = result.properties["header.i"]
  if (i === undefined) return undefined
  const at = i.lastIndexOf("@")
  return at < 0 ? undefined : i.slice(at + 1).toLowerCase()
}

export function verifiesFrom(header: string | undefined, fromDomain: string): boolean {
  if (header === undefined) return false
  const parsed = parseAuthenticationResults(header)
  if (parsed === undefined || parsed.authservId !== GMAIL_AUTHSERV_ID) return false
  const domain = fromDomain.toLowerCase()
  return parsed.results.some((result) => {
    if (result.result !== "pass") return false
    if (result.method === "dmarc") return result.properties["header.from"]?.toLowerCase() === domain
    if (result.method === "dkim") {
      const signer = dkimDomain(result)
      return signer !== undefined && aligned(signer, domain)
    }
    return false
  })
}
