import { randomUUID } from "node:crypto"
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import { createMatrixChannel } from "./host/channel"
import { createMatrixApi } from "./host/client-server/api"
import type { MatrixFetch } from "./host/client-server/http"
import type { Scheduler } from "./host/ports"
import {
  type AccountRecord,
  type CardRecord,
  type CursorRecord,
  type DigestRecord,
  type HomeRecord,
  type IncidentRecord,
  MATRIX_DOMAIN,
  type RecordTable,
} from "./host/records/domain"

export const name = "bot-matrix"
const BOT = "bot"
const STORAGE = "storageDomain"
export const inject = ["bot", "storageDomain"]

interface MatrixDomain {
  table(name: "accounts"): RecordTable<AccountRecord>
  table(name: "homes"): RecordTable<HomeRecord>
  table(name: "cursors"): RecordTable<CursorRecord>
  table(name: "cards"): RecordTable<CardRecord>
  table(name: "digests"): RecordTable<DigestRecord>
  table(name: "incidents"): RecordTable<IncidentRecord>
  close(): Promise<void>
}

interface StorageDomains {
  open(spec: typeof MATRIX_DOMAIN): Promise<MatrixDomain>
}

function serviceOf<T>(ctx: Context, name: string): T {
  const service = ctx.get(name) as T | undefined
  if (service === undefined) throw new Error(`the "${name}" service is not available; inject it`)
  return service
}

const matrixFetch: MatrixFetch = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body === undefined
      ? {}
      : { body: typeof init.body === "string" ? init.body : new Uint8Array(init.body) }),
    signal: init.signal,
    redirect: init.redirect,
  })
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
    body: response.body as AsyncIterable<Uint8Array> | null,
  }
}

export async function apply(ctx: Context): Promise<void> {
  const domain = await serviceOf<StorageDomains>(ctx, STORAGE).open(MATRIX_DOMAIN)
  ctx.effect(() => () => void domain.close(), "bot-matrix: storage domain")
  const timers = new Set<ReturnType<typeof setTimeout>>()
  ctx.effect(
    () => () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
    "bot-matrix: timers",
  )
  const scheduler: Scheduler = {
    later(ms, work) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        work()
      }, ms)
      timers.add(timer)
      return () => {
        clearTimeout(timer)
        timers.delete(timer)
      }
    },
  }
  const channel = createMatrixChannel({
    open: (homeserver, asToken) =>
      createMatrixApi({ fetch: matrixFetch, scheduler, newId: randomUUID }, homeserver, asToken),
    tables: {
      accounts: domain.table("accounts"),
      homes: domain.table("homes"),
      cursors: domain.table("cursors"),
      cards: domain.table("cards"),
      digests: domain.table("digests"),
      incidents: domain.table("incidents"),
    },
    scheduler,
    now: Date.now,
    warn: (message) => ctx.logger.warn(message),
  })
  ctx.effect(() => serviceOf<Bot>(ctx, BOT).registerChannel(channel), "bot-matrix: channel")
}
