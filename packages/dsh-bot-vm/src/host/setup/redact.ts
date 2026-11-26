export const REDACTED = "[redacted]"

export interface Redactor {
  add(secret: string): void
  apply(text: string): string
}

export function createRedactor(secrets: readonly (string | undefined)[] = []): Redactor {
  const known: string[] = []
  const redactor: Redactor = {
    add(secret) {
      if (secret === "" || known.includes(secret)) return
      known.push(secret)
      known.sort((a, b) => b.length - a.length)
    },
    apply(text) {
      let result = text
      for (const secret of known) result = result.replaceAll(secret, REDACTED)
      return result
    },
  }
  for (const secret of secrets) if (secret !== undefined) redactor.add(secret)
  return redactor
}
