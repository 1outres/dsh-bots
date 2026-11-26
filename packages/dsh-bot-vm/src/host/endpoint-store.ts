import type { ClientKeyStore, EndpointStore } from "./endpoint"
import { parseStoredScope, serializeStoredScope } from "./endpoint"

export interface StoreFiles {
  read(path: string): Promise<string | undefined>
  write(path: string, content: string, mode: number): Promise<void>
  remove(path: string): Promise<void>
}

export const ENDPOINT_FILE = "endpoint.json"

export function fileEndpointStore(path: string, files: StoreFiles): EndpointStore {
  return {
    async read() {
      const text = await files.read(path)
      return text === undefined ? undefined : parseStoredScope(text, path)
    },
    write: (scope) => files.write(path, serializeStoredScope(scope), 0o600),
    clear: () => files.remove(path),
  }
}

export interface SecretRecords {
  readRecord(
    key: string,
  ): Promise<{ readonly kind: string; readonly payload?: unknown } | undefined>
  modifyRecord(
    key: string,
    mutate: () => Promise<{ kind: "grant"; payload: ClientKeyPayload } | undefined>,
  ): Promise<unknown>
  deleteRecord(key: string): Promise<unknown>
}

export interface ClientKeyPayload {
  readonly version: 1
  readonly clientKey: string
}

export const clientKeyRecord = (plugin: string) => `${plugin}/incus-client`

export function recordClientKeyStore(records: SecretRecords, key: string): ClientKeyStore {
  return {
    async read() {
      const record = await records.readRecord(key)
      if (record === undefined) return undefined
      const payload = record.payload as Partial<ClientKeyPayload> | undefined
      if (
        record.kind !== "grant" ||
        payload?.version !== 1 ||
        typeof payload.clientKey !== "string"
      ) {
        throw new Error(`the secret record "${key}" is not one @1outres/dsh-bot-vm wrote`)
      }
      return payload.clientKey
    },
    async write(clientKey) {
      await records.modifyRecord(key, async () => ({
        kind: "grant",
        payload: { version: 1, clientKey },
      }))
    },
    async clear() {
      await records.deleteRecord(key)
    },
  }
}
