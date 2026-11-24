import type {
  BotAvatar,
  BotCreateInput,
  BotFailure,
  BotUpdateInput,
  BotView,
  CreationPhase,
} from "../shared/bots"
import { validateAvatar, validateLanguage, validateName } from "../shared/bots"
import type { BotEnvironmentSpec } from "../shared/environment"
import type { MainRotationReason } from "../shared/mains"
import type { BotModelSettings } from "../shared/models"
import type { BotOverlay } from "../shared/preset"
import { botPresetId } from "../shared/preset"
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

/** The slice of a storage-domain table the registry uses. */
export interface BotTable<V = BotRecord> {
  get(key: string): V | undefined
  entries(): Iterable<[string, V]>
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<unknown>
}

export interface BotRegistryDeps {
  table: BotTable
  /** Bot sessions keyed by session id: which bot each belongs to. */
  sessions: BotTable<BotSessionRecord>
  /** Throws when no bot can be created now (no environment to run it); nothing is stored then. */
  admit(): void
  /** The connectors of a new bot's creation options: selected before anything is stored, enabled before it is announced. */
  connectors: Pick<CreationConnectors, "select" | "enable">
  /**
   * A new bot's environment spec: made from the environment's capacity before
   * anything is stored, stored right after its record, before its connectors
   * are enabled (they are checked against it).
   */
  specs: {
    /** @throws when the environment cannot give the bot what `connectors` need. */
    initial(id: string, connectors: readonly CatalogConnector[]): Promise<BotEnvironmentSpec>
    create(id: string, spec: BotEnvironmentSpec): Promise<void>
    discard(id: string): Promise<void>
  }
  /** A new bot's models: checked before anything is stored, stored right after its record. */
  models: {
    initial(change: unknown): Promise<BotModelSettings>
    store(id: string, models: BotModelSettings): Promise<void>
    discard(id: string): Promise<void>
  }
  /**
   * Start the bot's Main session under the bot's composed Agent preset
   * (`Bot.createSession`, which records it with {@link BotRegistry.adopt}).
   * The record is stored (and its subscribers told) before this runs.
   * @returns the Main session id.
   */
  startMain(bot: { id: string; name: string }): Promise<string>
  /**
   * The Main session is stored as the bot's: send its opening prompt, so the
   * bot speaks first. Runs after the record names the Main, so the session is
   * already the Main when its first turn assembles its prompt.
   */
  openMain(bot: BotView): void
  /** Set the Main session's title to the bot's new name. */
  renameMain(sessionId: string, name: string): Promise<void>
  /** The canonical form of a bot's zone. @throws when `value` is not a usable IANA zone. */
  canonicalTimezone(value: unknown): string
  warn(message: string): void
  newId(): string
  now(): number
}

/** Why a creation stopped, as the record keeps it. */
export interface CreationFailure extends BotFailure {
  readonly phase: CreationPhase
}

/** A stored bot without a Main session: being created, or its creation failed. */
export interface CreatingBot {
  readonly id: string
  readonly name: string
  readonly avatar: BotAvatar
  readonly createdAt: number
  /** Its recorded sessions (a Main that started but is not stored yet). */
  readonly sessionIds: readonly string[]
  /** Its Main session is being started right now. */
  readonly startingMain: boolean
  readonly failure?: CreationFailure
}

/** What a removed record leaves to clean up. */
export interface RemovedBot extends BotSessions {
  readonly id: string
  readonly avatar: BotAvatar
  readonly createdAt: number
}

/** Which kind of stored bot a removal expects. */
export type RemovalTarget = "listed" | "creating"

export interface BotRegistry {
  list(): BotView[]
  /** Stored bots without a Main session, oldest first. */
  creating(): CreatingBot[]
  get(id: string): BotView | undefined
  /**
   * Store a new bot without a Main session, the connectors of its creation options enabled,
   * then announce it; resolves to its id. Subscribers prepare its environment
   * (with what those connectors need) and preset; {@link repairMains} starts its Main.
   */
  create(input: BotCreateInput): Promise<string>
  update(id: string, input: BotUpdateInput): Promise<BotView>
  /**
   * Delete the record of a listed bot, or of one being created. The bot
   * leaves the list (and the Main guard stops protecting its Main); its
   * sessions stay recorded as its own for the rest of the process, so the
   * caller archives them and then {@link forget}s them. `removed` runs once
   * the record is gone, before subscribers are told, so they never see the
   * bot neither stored nor taken over by the caller.
   * @throws when the bot does not exist or is not of the `expected` kind.
   */
  remove(id: string, expected: RemovalTarget, removed: (bot: RemovedBot) => void): Promise<void>
  /**
   * Delete the session records of a removed bot. Each is deleted on its own:
   * one failing does not keep the others; the failures are thrown together.
   */
  forget(sessionIds: readonly string[]): Promise<void>
  /**
   * Store why a creation stopped. Ignored for a bot that is not being
   * created, or whose creation already failed. Resolves to whether it was stored.
   */
  failCreation(id: string, failure: CreationFailure): Promise<boolean>
  /**
   * Clear a creation's failure, so the bot is prepared again.
   * @throws when the bot is not a creation that failed.
   */
  retryCreation(id: string): Promise<void>
  /**
   * Give every stored bot without a Main session and without a creation
   * failure one, or only those of `ids`. A bot that fails keeps the failure
   * (phase `starting-main`) and is reported; the others proceed. Safe to
   * call again.
   */
  repairMains(ids?: Iterable<string>): Promise<void>
  /**
   * Store the bot's template choice and/or overlay. In the write queue, the
   * change is merged into the current record and `validate` sees the merged
   * result; when it throws, nothing is stored. So two concurrent changes
   * never store a combination nobody validated.
   */
  setPreset(
    id: string,
    change: { readonly template?: string; readonly overlay?: BotOverlay },
    validate: (merged: BotRecord) => void,
  ): Promise<void>
  /**
   * Make `next` (a session recorded as the bot's) the bot's Main in place of
   * `expected`: the former Main's record keeps when and why it was replaced (`retiredMain`).
   * In the write queue; resolves to the bot's new view.
   * @throws when the bot does not exist, its Main is no longer `expected`, or `next` is not the bot's.
   */
  replaceMain(
    id: string,
    expected: string,
    next: string,
    reason: MainRotationReason,
  ): Promise<BotView>
  /** The bot whose Main session `sessionId` is. */
  botOfMain(sessionId: string): BotView | undefined
  /**
   * The bot a session belongs to: its Main, or a session recorded as the
   * bot's. A deleted bot's sessions stay its own for the rest of the process.
   */
  botOfSession(sessionId: string): string | undefined
  /** Every session recorded for a stored bot (its Main included), oldest first. */
  sessionsOf(botId: string): string[]
  /**
   * Record `sessionId` as a session of the stored bot `botId`. Idempotent;
   * not in the write queue (a Main starts inside it). Resolves to whether it
   * was recorded now; a session of another bot, or of a bot not stored, is not.
   */
  adopt(botId: string, sessionId: string, membership?: SessionMembership): Promise<boolean>
  /** Whether the session's record says the bot's Main session started it. */
  startedByMain(sessionId: string): boolean
  /** Whether the session was the bot's Main and a new Main took its place. */
  pastMain(sessionId: string): boolean
  /**
   * Version 1 records: record the sessions of the bot's former Workspace and
   * drop `path` / `workspaceId` from its record. `retire` drops the Workspace
   * registration; a failure is reported and the record keeps its Workspace id,
   * so the next start-up tries again.
   */
  migrateLegacy(
    sessionsOf: (workspaceId: string) => readonly string[] | undefined,
    retire: (workspaceId: string) => Promise<unknown>,
  ): Promise<void>
  /** Whether the bot's initial workspace files of this version were placed. */
  hasWorkspaceFiles(id: string, version: WorkspaceFilesVersion): boolean
  /** Store that the bot's initial workspace files of this version were placed. */
  markWorkspaceFiles(id: string, version: WorkspaceFilesVersion): Promise<void>
  /** Whether the bot's initial notes of this version were placed. */
  hasInitialNotes(id: string, version: InitialNotesVersion): boolean
  /** Store that the bot's initial notes of this version were placed. */
  markInitialNotes(id: string, version: InitialNotesVersion): Promise<void>
  /** The stored bot's time zone. @throws when the bot does not exist. */
  timezoneOf(id: string): string
  /**
   * Records written before bots had a time zone ran in the Host's: store it as
   * theirs (`hostZone` is read only when one has none). Start-up, before
   * anything reads bots.
   */
  migrateTimezones(hostZone: () => string): Promise<void>
  subscribe(listener: () => void): () => void
}

/** The record's time zone; every record has one once {@link BotRegistry.migrateTimezones} ran. */
function timezoneOf(id: string, record: BotRecord): string {
  if (record.timezone === undefined) throw new Error(`bot "${id}" has no time zone yet`)
  return record.timezone
}

/** One recorded session of a bot, with its id. */
export interface RecordedSession extends BotSessionRecord {
  readonly sessionId: string
}

/** A bot is listed once it has its Main session. */
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
    avatar: record.avatar as BotAvatar,
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

/** A record without the legacy Host fields. */
function withoutLegacy(record: BotRecord): BotRecord {
  const { path: _path, workspaceId: _workspaceId, ...rest } = record
  return rest
}

export function createBotRegistry(deps: BotRegistryDeps): BotRegistry {
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  // Serialize writes so creation, repair and updates never interleave.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  /** Sessions being recorded (their write not done yet), so lookups and repeats see them at once. */
  const adopting = new Map<string, BotSessionRecord>()
  /** Sessions of bots deleted since start: still theirs, so their Agents stay classified. */
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

  /** Bots whose Main is being started (in the write queue). */
  const starting = new Set<string>()

  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

  /** In the write queue: give a stored bot its Main unless it has one, and store it. */
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
      // Also the earlier field, so an older bot-core still reads this Main as on the bot preset.
      mainPreset: botPresetId(id),
      updatedAt: deps.now(),
    }
    await deps.table.put(id, complete)
    // Its opening is on its way before the bot is listed, so the browser never offers the blank Main's composer first.
    deps.openMain(requireView(id, complete))
    publish()
    return complete
  }

  /** Store a creation's failure, in the write queue. */
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
            avatar: record.avatar as BotAvatar,
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
        // Following the title is best effort: the rename itself already succeeded.
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
        // The record goes first: the Main guard stops protecting the Main and
        // subscribers release the bot's preset and environment.
        await deps.table.delete(id)
        removed({
          id,
          name: record.name,
          avatar: record.avatar as BotAvatar,
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
              // Workspace order is kept: Main first, then the Workspace's own order.
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
    hasWorkspaceFiles: (id, version) => deps.table.get(id)?.workspaceFiles === version,
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
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
