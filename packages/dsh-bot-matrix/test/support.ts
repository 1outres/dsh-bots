import type { MatrixApi, MatrixEvent, MatrixSync } from "../src/host/matrix"
import type { Scheduler } from "../src/host/ports"
import type { MatrixTables, RecordTable } from "../src/host/records/domain"

export function memoryTable<V>(): RecordTable<V> & { rows: Map<string, V> } {
  const rows = new Map<string, V>()
  return {
    rows,
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    async put(key, value) {
      rows.set(key, value)
    },
    async delete(key) {
      return rows.delete(key)
    },
  }
}

export function memoryTables(): MatrixTables {
  return {
    accounts: memoryTable(),
    homes: memoryTable(),
    cursors: memoryTable(),
    cards: memoryTable(),
    digests: memoryTable(),
    incidents: memoryTable(),
  }
}

export const immediate: Scheduler = {
  later(_ms, work) {
    queueMicrotask(work)
    return () => {}
  },
}

export function event(partial: Partial<MatrixEvent> & Pick<MatrixEvent, "eventId">): MatrixEvent {
  return {
    type: "m.room.message",
    sender: "@alice:example.org",
    originServerTs: 1,
    content: { msgtype: "m.text", body: "hi" },
    ...partial,
  }
}

export interface Call {
  readonly user: string | undefined
  readonly method: string
  readonly args: readonly unknown[]
}

export function fakeApi(
  overrides: Partial<MatrixApi> = {},
  calls: Call[] = [],
  user?: string,
): MatrixApi & { calls: Call[] } {
  let sent = 0
  const record = (method: string, args: readonly unknown[]) => calls.push({ user, method, args })
  const sync: MatrixSync = {
    nextBatch: "n",
    joined: new Map(),
    invited: new Map(),
    left: new Set(),
  }
  const base: MatrixApi = {
    user,
    as: (userId) => fakeApi(overrides, calls, userId),
    unauthenticated: async () => undefined,
    versions: async () => ["v1.11"],
    whoami: async () => "@dshbots:example.org",
    register: async (...args) => {
      record("register", args)
      return "created"
    },
    deactivate: async (...args) => void record("deactivate", args),
    uploadLimit: async () => 1024,
    sync: async (...args) => {
      record("sync", args)
      return sync
    },
    messages: async () => ({ chunk: [] }),
    send: async (...args) => {
      record("send", args)
      sent += 1
      return `$sent${sent}`
    },
    redact: async (...args) => void record("redact", args),
    typing: async (...args) => void record("typing", args),
    receipt: async (...args) => void record("receipt", args),
    createRoom: async (...args) => {
      record("createRoom", args)
      return "!dm:example.org"
    },
    join: async (...args) => void record("join", args),
    leave: async (...args) => void record("leave", args),
    forget: async (...args) => void record("forget", args),
    joinedRooms: async () => [],
    members: async () => [],
    state: async () => undefined,
    putState: async (...args) => void record("putState", args),
    profile: async (userId) => ({ displayName: userId.slice(1, userId.indexOf(":")) }),
    setDisplayName: async (...args) => void record("setDisplayName", args),
    setAvatarUrl: async (...args) => void record("setAvatarUrl", args),
    accountData: async () => undefined,
    setAccountData: async (...args) => void record("setAccountData", args),
    upload: async (...args) => {
      record("upload", args)
      return "mxc://example.org/up"
    },
    download: async () => new Uint8Array([1, 2, 3]),
    thumbnail: async () => undefined,
  }
  return Object.assign(
    { ...base, ...overrides, as: (userId: string) => fakeApi(overrides, calls, userId) },
    { calls },
  )
}

export async function settle(rounds = 20): Promise<void> {
  for (let at = 0; at < rounds; at += 1) await new Promise((resolve) => setImmediate(resolve))
}
