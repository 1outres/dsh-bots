export interface SecretStore {
  read(): Promise<string | undefined>
  write(secret: string): Promise<void>
  clear(): Promise<void>
}

export interface SecretRecords {
  readRecord(
    key: string,
  ): Promise<{ readonly kind: string; readonly payload?: unknown } | undefined>
  modifyRecord(
    key: string,
    mutate: () => Promise<{ kind: "grant"; payload: SecretPayload } | undefined>,
  ): Promise<unknown>
  deleteRecord(key: string): Promise<unknown>
}

export type SecretField = "clientKey" | "tokenSecret"

export type SecretPayload = { readonly version: 1 } & { readonly [Field in SecretField]?: string }

export interface SecretRecord {
  readonly key: string
  readonly field: SecretField
}

export const clientKeyRecord = (plugin: string): SecretRecord => ({
  key: `${plugin}/incus-client`,
  field: "clientKey",
})

export const proxmoxTokenRecord = (plugin: string): SecretRecord => ({
  key: `${plugin}/proxmox-token`,
  field: "tokenSecret",
})

export function recordSecretStore(records: SecretRecords, record: SecretRecord): SecretStore {
  const { key, field } = record
  return {
    async read() {
      const found = await records.readRecord(key)
      if (found === undefined) return undefined
      const payload = found.payload as Partial<Record<string, unknown>> | undefined
      const value = payload?.[field]
      if (found.kind !== "grant" || payload?.version !== 1 || typeof value !== "string") {
        throw new Error(`the secret record "${key}" is not one @1outres/dsh-bot-vm wrote`)
      }
      return value
    },
    async write(secret) {
      await records.modifyRecord(key, async () => ({
        kind: "grant",
        payload: { version: 1, [field]: secret },
      }))
    },
    async clear() {
      await records.deleteRecord(key)
    },
  }
}
