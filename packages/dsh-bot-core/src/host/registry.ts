import { type BotAvatar, validateAvatar } from "../shared/avatar"
import type {
  BotCreateInput,
  BotFailure,
  BotUpdateInput,
  BotView,
  CreationPhase,
} from "../shared/bots"
import { validateLanguage, validateName } from "../shared/bots"
import type { BotEnvironmentSpec } from "../shared/environment"
import type { MainRotationReason } from "../shared/mains"
import type { BotModelSettings } from "../shared/models"
import type { BotOverlay } from "../shared/preset"
import { botPresetId } from "../shared/preset"
import { avatarOfRecord, isLegacyAvatar } from "./avatar-migration"
import type { BotSessions } from "./cleanup"
import type { CatalogConnector } from "./connectors/catalog"
import type { CreationConnectors } from "./connectors/creation"
import type {
  BotRecord,
  BotSessionRecord,
  InitialNotesVersion,
  SessionMembership,
  WorkspaceFilesVersion,
} from "./domain"

export interface BotTable<V = BotRecord> {
  get(key: string): V | undefined
  entries(): Iterable<[string, V]>
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<unknown>
}

export interface BotRegistryDeps {
  table: BotTable
  sessions: BotTable<BotSessionRecord>
  admit(): void
  connectors: Pick<CreationConnectors, "select" | "enable">
  specs: {
    initial(id: string, connectors: readonly CatalogConnector[]): Promise<BotEnvironmentSpec>
    create(id: string, spec: BotEnvironmentSpec): Promise<void>
    discard(id: string): Promise<void>
  }
  models: {
    initial(change: unknown): Promise<BotModelSettings>
    store(id: string, models: BotModelSettings): Promise<void>
    discard(id: string): Promise<void>
  }
  startMain(bot: { id: string; name: string }): Promise<string>
  openMain(bot: BotView): void
  renameMain(sessionId: string, name: string): Promise<void>
  canonicalTimezone(value: unknown): string
  warn(message: string): void
  newId(): string
  now(): number
}

export interface CreationFailure extends BotFailure {
  readonly phase: CreationPhase
}

export interface CreatingBot {
  readonly id: string
  readonly name: string
  readonly avatar: BotAvatar
  readonly createdAt: number
  readonly sessionIds: readonly string[]
  readonly startingMain: boolean
  readonly failure?: CreationFailure
}

export interface RemovedBot extends BotSessions {
  readonly id: string
  readonly avatar: BotAvatar
  readonly createdAt: number
}

export type RemovalTarget = "listed" | "creating"

export interface BotRegistry {
  list(): BotView[]
  creating(): CreatingBot[]
  get(id: string): BotView | undefined
  create(input: BotCreateInput): Promise<string>
  update(id: string, input: BotUpdateInput): Promise<BotView>
  remove(id: string, expected: RemovalTarget, removed: (bot: RemovedBot) => void): Promise<void>
  forget(sessionIds: readonly string[]): Promise<void>
  failCreation(id: string, failure: CreationFailure): Promise<boolean>
  retryCreation(id: string): Promise<void>
  repairMains(ids?: Iterable<string>): Promise<void>
  setPreset(
    id: string,
    change: { readonly template?: string; readonly overlay?: BotOverlay },
    validate: (merged: BotRecord) => void,
  ): Promise<void>
  replaceMain(
    id: string,
    expected: string,
    next: string,
    reason: MainRotationReason,
  ): Promise<BotView>
  botOfMain(sessionId: string): BotView | undefined
  botOfSession(sessionId: string): string | undefined
  sessionsOf(botId: string): string[]
  adopt(botId: string, sessionId: string, membership?: SessionMembership): Promise<boolean>
  startedByMain(sessionId: string): boolean
  pastMain(sessionId: string): boolean
  mainsOf(botId: string): readonly BotMainRecord[] | undefined
  migrateLegacy(
    sessionsOf: (workspaceId: string) => readonly string[] | undefined,
    retire: (workspaceId: string) => Promise<unknown>,
  ): Promise<void>
  workspaceFilesOf(id: string): WorkspaceFilesVersion | undefined
  markWorkspaceFiles(id: string, version: WorkspaceFilesVersion): Promise<void>
  hasInitialNotes(id: string, version: InitialNotesVersion): boolean
  markInitialNotes(id: string, version: InitialNotesVersion): Promise<void>
  timezoneOf(id: string): string
  migrateTimezones(hostZone: () => string): Promise<void>
  migrateAvatars(): Promise<void>
  subscribe(listener: () => void): () => void
}

function timezoneOf(id: string, record: BotRecord): string {
  if (record.timezone === undefined) throw new Error(`bot "${id}" has no time zone yet`)
  return record.timezone
}

export interface BotMainRecord {
  readonly sessionId: string
  readonly endedAt?: number
}

export interface RecordedSession extends BotSessionRecord {
  readonly sessionId: string
}

function viewOf(
  id: string,
  record: BotRecord,
  sessions: readonly RecordedSession[],
): BotView | undefined {
  const main = record.mainSessionId
  if (main === undefined) return undefined
  return {
    id,
    name: record.name,
    avatar: avatarOfRecord(record),
    mainSessionId: main,
    mainStartedAt:
      sessions.find((session) => session.sessionId === main)?.createdAt ?? record.createdAt,
    sessionIds: sessions
      .filter((session) => session.sessionId !== main)
      .map((session) => ({ session, joinedAt: session.retiredMain?.endedAt ?? session.createdAt }))
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map(({ session }) => session.sessionId),
    formerMainIds: sessions
      .filter((session) => session.sessionId !== main && session.retiredMain !== undefined)
      .map((session) => session.sessionId),
    timezone: timezoneOf(id, record),
    ...(record.language === undefined ? {} : { language: record.language }),
    createdAt: record.createdAt,
  }
}

function withoutLegacy(record: BotRecord): BotRecord {
  const { path: _path, workspaceId: _workspaceId, ...rest } = record
  return rest
}

export function createBotRegistry(deps: BotRegistryDeps): BotRegistry {
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const adopting = new Map<string, BotSessionRecord>()
  const departed = new Map<string, string>()

  const requireRecord = (id: string): BotRecord => {
    const record = deps.table.get(id)
    if (record === undefined) throw new Error(`bot "${id}" does not exist`)
    return record
  }

  const sessionRecord = (sessionId: string) =>
    adopting.get(sessionId) ?? deps.sessions.get(sessionId)

  const recordedOf = (botId: string): RecordedSession[] => {
    const found = new Map<string, BotSessionRecord>()
    for (const [sessionId, record] of deps.sessions.entries()) {
      if (record.botId === botId) found.set(sessionId, record)
    }
    for (const [sessionId, record] of adopting) {
      if (record.botId === botId) found.set(sessionId, record)
    }
    return [...found]
      .map(([sessionId, record]) => ({ ...record, sessionId }))
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId),
      )
  }

  const sessionsOf = (botId: string): string[] =>
    recordedOf(botId).map((session) => session.sessionId)

  const view = (id: string, record: BotRecord) => viewOf(id, record, recordedOf(id))

  const requireView = (id: string, record: BotRecord): BotView => {
    const found = view(id, record)
    if (found === undefined) throw new Error(`bot "${id}" has no Main session`)
    return found
  }

  const starting = new Set<string>()

  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

  const startMainOf = async (id: string): Promise<BotRecord> => {
    const record = requireRecord(id)
    if (record.mainSessionId !== undefined) return record
    starting.add(id)
    publish()
    let mainSessionId: string
    try {
      mainSessionId = await deps.startMain({ id, name: record.name })
    } finally {
      starting.delete(id)
    }
    const complete: BotRecord = {
      ...requireRecord(id),
      mainSessionId,
      mainOnBotPreset: true,
      mainPreset: botPresetId(id),
      updatedAt: deps.now(),
    }
    await deps.table.put(id, complete)
    deps.openMain(requireView(id, complete))
    publish()
    return complete
  }

  const storeFailure = async (id: string, failure: CreationFailure): Promise<boolean> => {
    const record = deps.table.get(id)
    if (record === undefined || record.mainSessionId !== undefined) return false
    if (record.creationFailure !== undefined) return false
    await deps.table.put(id, { ...record, creationFailure: { ...failure }, updatedAt: deps.now() })
    publish()
    return true
  }

  return {
    list() {
      return [...deps.table.entries()]
        .flatMap(([id, record]) => view(id, record) ?? [])
        .sort((left, right) => left.createdAt - right.createdAt)
    },
    creating() {
      return [...deps.table.entries()]
        .filter(([, record]) => record.mainSessionId === undefined)
        .map(
          ([id, record]): CreatingBot => ({
            id,
            name: record.name,
            avatar: avatarOfRecord(record),
            createdAt: record.createdAt,
            sessionIds: sessionsOf(id),
            startingMain: starting.has(id),
            ...(record.creationFailure === undefined ? {} : { failure: record.creationFailure }),
          }),
        )
        .sort((left, right) => left.createdAt - right.createdAt)
    },
    get(id) {
      const record = deps.table.get(id)
      return record === undefined ? undefined : view(id, record)
    },
    async create(input) {
      const name = validateName(input.name)
      const avatar = validateAvatar(input.avatar)
      const connectors = deps.connectors.select(input)
      const language = validateLanguage(input.language)
      const timezone = deps.canonicalTimezone(input.timezone)
      const models = await deps.models.initial(input.models)
      deps.admit()
      const id = deps.newId()
      const spec = await deps.specs.initial(id, connectors)
      return serial(async () => {
        const now = deps.now()
        await deps.table.put(id, {
          name,
          avatar,
          timezone,
          language,
          createdAt: now,
          updatedAt: now,
        })
        try {
          await deps.models.store(id, models)
          await deps.specs.create(id, spec)
          await deps.connectors.enable(id, connectors)
        } catch (error) {
          await deps.specs.discard(id)
          await deps.models.discard(id)
          await deps.table.delete(id)
          throw error
        }
        publish()
        return id
      })
    },
    async update(id, input) {
      const name = input.name === undefined ? undefined : validateName(input.name)
      const avatar = input.avatar === undefined ? undefined : validateAvatar(input.avatar)
      const timezone =
        input.timezone === undefined ? undefined : deps.canonicalTimezone(input.timezone)
      const language = input.language === undefined ? undefined : validateLanguage(input.language)
      return serial(async () => {
        const current = requireRecord(id)
        const record: BotRecord = {
          ...current,
          ...(name === undefined ? {} : { name }),
          ...(avatar === undefined ? {} : { avatar }),
          ...(timezone === undefined ? {} : { timezone }),
          ...(language === undefined ? {} : { language }),
          updatedAt: deps.now(),
        }
        await deps.table.put(id, record)
        publish()
        if (name !== undefined && name !== current.name && record.mainSessionId !== undefined) {
          try {
            await deps.renameMain(record.mainSessionId, name)
          } catch (error) {
            deps.warn(`bot-core: could not retitle the Main session of "${name}": ${String(error)}`)
          }
        }
        return requireView(id, record)
      })
    },
    remove(id, expected, removed) {
      return serial(async () => {
        const record = requireRecord(id)
        const listed = record.mainSessionId !== undefined
        if (expected === "listed" && !listed) {
          throw new Error(
            `bot "${record.name}" is still being created; discard its creation instead`,
          )
        }
        if (expected === "creating" && listed) {
          throw new Error(`bot "${record.name}" has been created; delete it instead`)
        }
        const sessionIds = sessionsOf(id)
        for (const sessionId of sessionIds) departed.set(sessionId, id)
        if (record.mainSessionId !== undefined) departed.set(record.mainSessionId, id)
        await deps.table.delete(id)
        removed({
          id,
          name: record.name,
          avatar: avatarOfRecord(record),
          createdAt: record.createdAt,
          mainSessionId: record.mainSessionId,
          sessionIds,
          workspaceId: record.workspaceId,
        })
        publish()
      })
    },
    async forget(sessionIds) {
      const failures: unknown[] = []
      for (const sessionId of sessionIds) {
        adopting.delete(sessionId)
        try {
          await deps.sessions.delete(sessionId)
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `could not forget ${failures.length} of ${sessionIds.length} sessions: ${failures.map(describe).join("; ")}`,
        )
      }
    },
    failCreation(id, failure) {
      return serial(() => storeFailure(id, failure))
    },
    retryCreation(id) {
      return serial(async () => {
        const record = requireRecord(id)
        if (record.mainSessionId !== undefined || record.creationFailure === undefined) {
          throw new Error(`the creation of bot "${record.name}" has not failed`)
        }
        const { creationFailure: _failure, ...rest } = record
        await deps.table.put(id, { ...rest, updatedAt: deps.now() })
        publish()
      })
    },
    repairMains(ids) {
      const only = ids === undefined ? undefined : new Set(ids)
      return serial(async () => {
        for (const [id, record] of [...deps.table.entries()]) {
          if (record.mainSessionId !== undefined || record.creationFailure !== undefined) continue
          if (only?.has(id) === false) continue
          try {
            await startMainOf(id)
          } catch (error) {
            deps.warn(
              `bot-core: could not start the Main session of "${record.name}" (${id}): ${describe(error)}`,
            )
            await storeFailure(id, {
              phase: "starting-main",
              message: describe(error),
              at: deps.now(),
            })
          }
        }
      })
    },
    setPreset(id, change, validate) {
      return serial(async () => {
        const current = requireRecord(id)
        const merged: BotRecord = {
          ...current,
          ...(change.template === undefined ? {} : { template: change.template }),
          ...(change.overlay === undefined
            ? {}
            : { overlay: [...change.overlay] as NonNullable<BotRecord["overlay"]> }),
          updatedAt: deps.now(),
        }
        validate(merged)
        await deps.table.put(id, merged)
        publish()
      })
    },
    replaceMain(id, expected, next, reason) {
      return serial(async () => {
        const record = requireRecord(id)
        if (record.mainSessionId !== expected) {
          throw new Error(`the Main session of bot "${record.name}" is no longer "${expected}"`)
        }
        const former = sessionRecord(expected)
        const successor = sessionRecord(next)
        if (successor?.botId !== id) throw new Error(`session "${next}" is not bot "${id}"'s`)
        const now = deps.now()
        await deps.sessions.put(expected, {
          botId: id,
          createdAt: former?.createdAt ?? record.createdAt,
          retiredMain: { endedAt: now, reason },
        })
        const replaced: BotRecord = {
          ...record,
          mainSessionId: next,
          mainOnBotPreset: true,
          mainPreset: botPresetId(id),
          updatedAt: now,
        }
        await deps.table.put(id, replaced)
        publish()
        return requireView(id, replaced)
      })
    },
    botOfMain(sessionId) {
      for (const [id, record] of deps.table.entries()) {
        if (record.mainSessionId === sessionId) return view(id, record)
      }
      return undefined
    },
    botOfSession(sessionId) {
      const recorded = sessionRecord(sessionId)?.botId
      if (recorded !== undefined) return recorded
      for (const [id, record] of deps.table.entries()) {
        if (record.mainSessionId === sessionId) return id
      }
      return departed.get(sessionId)
    },
    sessionsOf,
    async adopt(botId, sessionId, membership = {}) {
      if (deps.table.get(botId) === undefined || sessionRecord(sessionId) !== undefined) {
        return false
      }
      const record: BotSessionRecord = { botId, createdAt: deps.now(), ...membership }
      adopting.set(sessionId, record)
      try {
        await deps.sessions.put(sessionId, record)
      } finally {
        if (adopting.get(sessionId) === record) adopting.delete(sessionId)
      }
      publish()
      return true
    },
    startedByMain: (sessionId) => sessionRecord(sessionId)?.startedBy === "main",
    pastMain: (sessionId) => sessionRecord(sessionId)?.retiredMain !== undefined,
    mainsOf(botId) {
      const main = deps.table.get(botId)?.mainSessionId
      if (main === undefined) return undefined
      const former = recordedOf(botId).flatMap((session) =>
        session.sessionId === main || session.retiredMain === undefined
          ? []
          : [{ sessionId: session.sessionId, endedAt: session.retiredMain.endedAt }],
      )
      return [...former.sort((left, right) => left.endedAt - right.endedAt), { sessionId: main }]
    },
    migrateLegacy(sessionsOfWorkspace, retire) {
      return serial(async () => {
        let changed = false
        for (const [id, record] of [...deps.table.entries()]) {
          if (record.path === undefined && record.workspaceId === undefined) continue
          const workspaceId = record.workspaceId
          if (workspaceId !== undefined) {
            const legacy = [
              ...(record.mainSessionId === undefined ? [] : [record.mainSessionId]),
              ...(sessionsOfWorkspace(workspaceId) ?? []),
            ]
            for (const [index, sessionId] of legacy.entries()) {
              if (sessionRecord(sessionId) !== undefined) continue
              await deps.sessions.put(sessionId, { botId: id, createdAt: record.createdAt + index })
            }
            try {
              await retire(workspaceId)
            } catch (error) {
              deps.warn(
                `bot-core: could not retire the Workspace of bot "${record.name}" (${id}); it is tried again at the next start: ${String(error)}`,
              )
              continue
            }
          }
          await deps.table.put(id, withoutLegacy(record))
          changed = true
        }
        if (changed) publish()
      })
    },
    workspaceFilesOf: (id) => deps.table.get(id)?.workspaceFiles,
    markWorkspaceFiles(id, version) {
      return serial(async () => {
        const record = deps.table.get(id)
        if (record === undefined || record.workspaceFiles === version) return
        await deps.table.put(id, { ...record, workspaceFiles: version, updatedAt: deps.now() })
      })
    },
    hasInitialNotes: (id, version) => deps.table.get(id)?.initialNotes === version,
    markInitialNotes(id, version) {
      return serial(async () => {
        const record = deps.table.get(id)
        if (record === undefined || record.initialNotes === version) return
        await deps.table.put(id, { ...record, initialNotes: version, updatedAt: deps.now() })
      })
    },
    timezoneOf: (id) => timezoneOf(id, requireRecord(id)),
    migrateTimezones(hostZone) {
      return serial(async () => {
        let changed = false
        for (const [id, record] of [...deps.table.entries()]) {
          if (record.timezone !== undefined) continue
          await deps.table.put(id, { ...record, timezone: deps.canonicalTimezone(hostZone()) })
          changed = true
        }
        if (changed) publish()
      })
    },
    migrateAvatars() {
      return serial(async () => {
        let changed = false
        for (const [id, record] of [...deps.table.entries()]) {
          if (!isLegacyAvatar(record.avatar)) continue
          await deps.table.put(id, { ...record, avatar: avatarOfRecord(record) })
          changed = true
        }
        if (changed) publish()
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
