import {
  BOT_WEB_CAPABILITIES,
  type BotWebText,
  isWebBackendId,
  isWebSecretKey,
} from "../../shared/web"
import type { BotWebBackend } from "../../web-contract"

export interface WebBackendCatalog {
  register(backend: BotWebBackend): () => void
  get(id: string): BotWebBackend | undefined
  list(): readonly BotWebBackend[]
  subscribe(listener: (backendId: string) => void): () => void
}

function checkText(text: unknown, what: string): void {
  if (typeof text !== "object" || text === null) throw new Error(`${what} is missing`)
  const value = text as Partial<BotWebText>
  if (typeof value.en !== "string" || value.en.trim().length === 0) {
    throw new Error(`${what} has no English text`)
  }
  if (value.ja !== undefined && typeof value.ja !== "string")
    throw new Error(`${what}.ja is not text`)
}

export function checkWebBackendDescriptor(backend: BotWebBackend): void {
  if (!isWebBackendId(backend.id)) {
    throw new Error(
      `web backend id "${String(backend.id)}" must be lowercase letters, digits and hyphens`,
    )
  }
  const what = `web backend "${backend.id}"`
  checkText(backend.name, `${what} name`)
  if (backend.description !== undefined) checkText(backend.description, `${what} description`)
  if (!Array.isArray(backend.secrets) || backend.secrets.length === 0) {
    throw new Error(`${what} declares no secret`)
  }
  const keys = new Set<string>()
  for (const secret of backend.secrets) {
    if (!isWebSecretKey(secret.key)) {
      throw new Error(
        `${what} secret "${String(secret.key)}": the key must be camelCase letters and digits`,
      )
    }
    if (keys.has(secret.key)) throw new Error(`${what} secret "${secret.key}" is declared twice`)
    keys.add(secret.key)
    checkText(secret.label, `${what} secret "${secret.key}" label`)
  }
  const operations = BOT_WEB_CAPABILITIES.filter((capability) => backend[capability] !== undefined)
  if (operations.length === 0) throw new Error(`${what} can neither search nor fetch`)
  for (const capability of operations) {
    const operation = backend[capability]
    if (operation?.placement !== "host") {
      throw new Error(`${what} ${capability}: placement must be "host"`)
    }
    if (typeof operation.run !== "function") throw new Error(`${what} ${capability} has no run`)
  }
  if (typeof backend.test !== "function") throw new Error(`${what} has no test`)
}

export function createWebBackendCatalog(): WebBackendCatalog {
  const backends = new Map<string, { readonly backend: BotWebBackend }>()
  const listeners = new Set<(backendId: string) => void>()
  const publish = (backendId: string) => {
    for (const listener of [...listeners]) listener(backendId)
  }
  return {
    register(backend) {
      checkWebBackendDescriptor(backend)
      if (backends.has(backend.id)) {
        throw new Error(`web backend "${backend.id}" is already registered`)
      }
      const record = { backend }
      backends.set(backend.id, record)
      publish(backend.id)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        if (backends.get(backend.id) !== record) return
        backends.delete(backend.id)
        publish(backend.id)
      }
    },
    get: (id) => backends.get(id)?.backend,
    list: () => [...backends.values()].map((record) => record.backend),
    subscribe(listener) {
      const entry = (backendId: string) => listener(backendId)
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
  }
}
