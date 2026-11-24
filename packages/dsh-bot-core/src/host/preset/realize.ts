import type { BotOverlay, BotPresetPreview, BotPresetState } from "../../shared/preset"
import { botPresetId, DEFAULT_TEMPLATE_ID } from "../../shared/preset"
import { parseOverlay } from "../domain"
import { composeBotPreset, composeRows } from "./compose"
import type {
  BotPresetComposition,
  ComposedPreset,
  CompositionInput,
  CompositionProblem,
  EnvironmentLayer,
  Seal,
  TemplateCatalog,
  WebComposition,
} from "./types"

/** What a bot contributes to its preset, read from its stored record. */
export interface BotPresetSource {
  readonly name: string
  /** Absent means {@link DEFAULT_TEMPLATE_ID}. */
  readonly template?: string | undefined
  /** As stored; composing validates it. Absent means none. */
  readonly overlay?: unknown
}

export interface PresetRealizerDeps {
  catalog: Pick<TemplateCatalog, "get" | "subscribe">
  /** The bot's current inputs, or undefined once it is gone. Read when its turn runs. */
  source(botId: string): BotPresetSource | undefined
  /** Every stored bot. */
  botIds(): Iterable<string>
  /** Host tools templates may grant (bot-core's `allowedHostTools` config). */
  allowedHostTools: ReadonlySet<string>
  /** What every bot's web lookup offers now; read when a bot's turn runs. */
  web(): WebComposition
  /** The bot environment (`createEnvironmentKeeper`). */
  environment: {
    /**
     * The layer the composition goes into, or undefined while no environment is registered.
     * @throws when the environment cannot give its rows.
     */
    layer(target: { id: string; name: string }): EnvironmentLayer | undefined
    /** Whether the environment is ready for the bot. */
    status(
      botId: string,
    ):
      | { readonly ready: true }
      | { readonly ready: false; readonly problem: string; readonly pending?: true }
  }
  /** Seals a composition's revision into its files row token. */
  seal: Seal
  /** `agentPresets.register`; resolves to the registration's disposer. */
  register(preset: ComposedPreset): Promise<() => Promise<void>>
  /** Why a registered preset cannot compose a session (`agentPresets.resolve(id).broken`), or undefined. */
  diagnose(presetId: string): Promise<string | undefined>
  /** Run `work` after `ms`; returns a canceller. */
  later(work: () => void, ms: number): () => void
  warn(message: string): void
  /** How long a template may be missing before it is reported. Default 10 s. */
  graceMs?: number
  /** How long catalog changes are coalesced. Default 100 ms. */
  settleMs?: number
  /** Delay before a "Duplicate agent preset" registration is retried. Default 500 ms. */
  duplicateRetryMs?: number
}

/** A bot's configuration checked against the current catalog and environment; registers nothing. */
export type PresetCheck =
  | CompositionProblem
  | { readonly ok: true; readonly hostTools: readonly string[] }

/** The live registration of a bot's preset. */
export interface PresetRegistration {
  readonly revision: string
  readonly hostTools: readonly string[]
  readonly revisionToken: string
}

/**
 * Keeps one registered Agent preset per bot in step with its stored template
 * choice, overlay, the template catalog and the bot's environment.
 *
 * - One bot's work runs strictly in order, so a session never sees the gap of
 *   an unregister → register swap; different bots proceed independently.
 * - An unchanged composition (equal digest) stays registered; a changed one is
 *   swapped in place. Live Agents keep the revision they started with.
 * - Registered means usable: whenever the configuration cannot be realized the
 *   old registration is removed and the state turns `ready: false`.
 * - A missing template is `pending` and reported only after
 *   {@link PresetRealizerDeps.graceMs}; catalog changes are coalesced for
 *   {@link PresetRealizerDeps.settleMs}.
 * - A "Duplicate agent preset" refusal (a previous load still releasing) is retried later.
 * - A preset is registered only inside the environment's group, while the
 *   environment is ready for the bot.
 */
export interface PresetRealizer {
  /**
   * Bring one bot's registration in step with its record, in the bot's turn.
   * A composition whose registration failed is not retried while it stays the
   * same, unless `retry` is set.
   * @returns the bot's state, or undefined when the bot no longer exists (its
   *   registration is then removed).
   */
  refresh(botId: string, options?: { retry?: boolean }): Promise<BotPresetState | undefined>
  /** {@link refresh} every stored bot, and drop the registrations of removed ones. */
  refreshAll(): Promise<void>
  /**
   * Run `work` in the bot's turn, right after a {@link refresh} with retry,
   * so nothing re-registers the bot's preset while `work` runs.
   * @throws when the bot does not exist.
   */
  run<T>(botId: string, work: (state: BotPresetState) => Promise<T>): Promise<T>
  /**
   * Validate `source` for `botId` against the current catalog, and against the
   * environment's layer once one is registered, registering nothing.
   */
  check(botId: string, source: BotPresetSource): PresetCheck
  /** {@link check}, reported as a {@link BotPresetPreview}. */
  preview(botId: string, source: BotPresetSource): BotPresetPreview
  /**
   * Wait until the bot's queued work is done and its template is no longer
   * pending, or `timeoutMs` passed, or the realizer is disposed. Never rejects.
   */
  settled(botId: string, timeoutMs: number): Promise<void>
  /** Current state; a stored bot not realized yet reads as not ready. */
  state(botId: string): BotPresetState | undefined
  registration(botId: string): PresetRegistration | undefined
  /** Whether `botId` is stored, or had a preset since start (its Agents may still live). */
  isBot(botId: string): boolean
  /** Called with the bot id after its state or registration changed. */
  subscribe(listener: (botId: string) => void): () => void
  /** Stop: unregister every bot preset; later work registers nothing. */
  dispose(): Promise<void>
}

type Plan =
  | CompositionProblem
  | { readonly ok: true; readonly environment: "absent"; readonly hostTools: readonly string[] }
  | {
      readonly ok: true
      readonly environment: "present"
      readonly hostTools: readonly string[]
      readonly composition: BotPresetComposition
    }

interface Live extends PresetRegistration {
  readonly dispose: () => Promise<void>
}

interface Entry {
  live: Live | undefined
  /** Digest whose registration failed; not retried without `retry`. */
  failedDigest: string | undefined
  state: BotPresetState
}

const DUPLICATE = /duplicate agent preset/i
const MAX_DUPLICATE_RETRIES = 10

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameState(left: BotPresetState | undefined, right: BotPresetState | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createPresetRealizer(deps: PresetRealizerDeps): PresetRealizer {
  const graceMs = deps.graceMs ?? 10_000
  const settleMs = deps.settleMs ?? 100
  const duplicateRetryMs = deps.duplicateRetryMs ?? 500
  const entries = new Map<string, Entry>()
  /** Bots that had a registration since start, so Agents of a removed bot stay recognized. */
  const known = new Set<string>()
  const queues = new Map<string, Promise<unknown>>()
  const listeners = new Set<(botId: string) => void>()
  const timers = new Set<() => void>()
  const duplicateRetries = new Map<string, number>()
  const pendingTemplates = new Set<string>()
  /** Wakers of every {@link PresetRealizer.settled} wait, so dispose ends them. */
  const waiters = new Set<() => void>()
  let closed = false

  const schedule = (work: () => void, ms: number) => {
    const cancel = deps.later(() => {
      timers.delete(cancel)
      if (!closed) work()
    }, ms)
    timers.add(cancel)
  }

  const enqueue = <T>(botId: string, work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(botId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => {})
    queues.set(botId, tail)
    void tail.then(() => {
      if (queues.get(botId) === tail) queues.delete(botId)
    })
    return next
  }

  const listen = (listener: (botId: string) => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const notify = (botId: string) => {
    for (const listener of [...listeners]) {
      try {
        listener(botId)
      } catch (error) {
        deps.warn(`bot-core: a preset change listener failed for "${botId}": ${describe(error)}`)
      }
    }
  }

  /** Store `entry` and tell listeners when the state or the registration changed. */
  const commit = (botId: string, entry: Entry | undefined, registrationChanged: boolean) => {
    const before = entries.get(botId)?.state
    if (entry === undefined) entries.delete(botId)
    else entries.set(botId, entry)
    if (registrationChanged || !sameState(before, entry?.state)) notify(botId)
  }

  const templateOf = (source: BotPresetSource) => source.template ?? DEFAULT_TEMPLATE_ID

  const inputOf = (
    botId: string,
    source: BotPresetSource,
  ): CompositionProblem | { readonly ok: true; readonly input: CompositionInput } => {
    const templateId = templateOf(source)
    const template = deps.catalog.get(templateId)
    if (template === undefined) {
      return { ok: false, problem: `template "${templateId}" is not registered` }
    }
    // Stored overlays passed the outside checks of parseOverlay when they were configured.
    let overlay: BotOverlay = []
    if (source.overlay !== undefined) {
      try {
        overlay = parseOverlay(source.overlay, { trusted: true })
      } catch (error) {
        return { ok: false, problem: `the stored overlay is not usable: ${describe(error)}` }
      }
    }
    const input = {
      botId,
      botName: source.name,
      template,
      overlay,
      allowedHostTools: deps.allowedHostTools,
      web: deps.web(),
    }
    return { ok: true, input }
  }

  const plan = (botId: string, source: BotPresetSource): Plan => {
    const prepared = inputOf(botId, source)
    if (!prepared.ok) return prepared
    let layer: EnvironmentLayer | undefined
    try {
      layer = deps.environment.layer({ id: botId, name: source.name })
    } catch (error) {
      return { ok: false, problem: `the bot's environment gave no rows: ${describe(error)}` }
    }
    if (layer === undefined) {
      const rows = composeRows(prepared.input)
      return rows.ok ? { ok: true, environment: "absent", hostTools: rows.hostTools } : rows
    }
    const composition = composeBotPreset({ ...prepared.input, environment: layer, seal: deps.seal })
    return composition.ok
      ? { ok: true, environment: "present", hostTools: composition.hostTools, composition }
      : composition
  }

  const check = (botId: string, source: BotPresetSource): PresetCheck => {
    const result = plan(botId, source)
    return result.ok ? { ok: true, hostTools: result.hostTools } : result
  }

  const release = async (dispose: (() => Promise<void>) | undefined, id: string) => {
    if (dispose === undefined) return
    try {
      await dispose()
    } catch (error) {
      deps.warn(`bot-core: could not unregister Agent preset "${id}": ${describe(error)}`)
    }
  }

  /** The bot cannot be realized: drop any registration and report `problem`. */
  const fail = async (
    botId: string,
    template: string,
    problem: string,
    options: {
      wasRegistered: boolean
      failedDigest?: string
      pending?: boolean
      /** What is missing: a `pending` template is reported after the grace period; the environment reports its own failures. */
      cause?: "template" | "environment"
    },
  ): Promise<BotPresetState> => {
    const previous = entries.get(botId)
    const state: BotPresetState = {
      id: botPresetId(botId),
      ready: false,
      template,
      problem,
      ...(options.pending === true ? { pending: true as const } : {}),
    }
    const repeated = previous?.state.ready === false && previous.state.problem === problem
    if (options.cause === "environment") {
      // Preparing an environment takes a while, and the environment warns about its own failures.
    } else if (options.pending === true) {
      if (!pendingTemplates.has(botId)) {
        pendingTemplates.add(botId)
        schedule(() => {
          const current = entries.get(botId)?.state
          if (current?.ready === false && current.pending === true) {
            deps.warn(
              `bot-core: the Agent preset of bot "${botId}" is still not usable: ${current.problem}`,
            )
          }
        }, graceMs)
      }
    } else if (!repeated) {
      deps.warn(`bot-core: the Agent preset of bot "${botId}" is not usable: ${problem}`)
    }
    commit(
      botId,
      { live: undefined, state, failedDigest: options.failedDigest },
      options.wasRegistered,
    )
    return state
  }

  /** Drop the bot's live registration, if any. */
  const unregister = async (entry: Entry | undefined, id: string) => {
    const previous = entry?.live
    if (entry !== undefined) entry.live = undefined
    await release(previous?.dispose, id)
  }

  const realize = async (botId: string, retry: boolean): Promise<BotPresetState | undefined> => {
    const id = botPresetId(botId)
    const source = closed ? undefined : deps.source(botId)
    const entry = entries.get(botId)
    if (source === undefined) {
      if (entry?.live !== undefined) {
        commit(botId, undefined, true)
        await release(entry.live.dispose, id)
      } else if (entry !== undefined) {
        commit(botId, undefined, false)
      }
      return undefined
    }
    const template = templateOf(source)
    const result = plan(botId, source)
    const wasRegistered = entry?.live !== undefined
    if (!result.ok) {
      await unregister(entry, id)
      return fail(botId, template, result.problem, {
        wasRegistered,
        pending: deps.catalog.get(template) === undefined,
        cause: "template",
      })
    }
    pendingTemplates.delete(botId)
    const environment = deps.environment.status(botId)
    if (!environment.ready) {
      await unregister(entry, id)
      return fail(botId, template, environment.problem, {
        wasRegistered,
        pending: environment.pending === true,
        cause: "environment",
      })
    }
    if (result.environment === "absent") {
      await unregister(entry, id)
      return fail(botId, template, "the preset is not inside the bot's environment", {
        wasRegistered,
      })
    }
    const { composition } = result
    if (entry?.live !== undefined && entry.live.revision === composition.digest) return entry.state
    if (!retry && entry?.live === undefined && entry?.failedDigest === composition.digest) {
      return entry.state
    }
    // The registry drops the old id synchronously, so the new registration can start before the old revision finishes collecting.
    const previous = entry?.live
    if (entry !== undefined) entry.live = undefined
    const releasing = release(previous?.dispose, id)
    let dispose: () => Promise<void>
    try {
      dispose = await deps.register(composition.preset)
    } catch (error) {
      await releasing
      if (DUPLICATE.test(describe(error))) {
        const attempts = (duplicateRetries.get(botId) ?? 0) + 1
        duplicateRetries.set(botId, attempts)
        if (attempts <= MAX_DUPLICATE_RETRIES) {
          schedule(() => void refresh(botId, { retry: true }), duplicateRetryMs)
          return fail(botId, template, `registration failed: ${describe(error)}; retrying`, {
            wasRegistered,
          })
        }
      }
      return fail(botId, template, `registration failed: ${describe(error)}`, {
        wasRegistered,
        failedDigest: composition.digest,
      })
    }
    duplicateRetries.delete(botId)
    await releasing
    known.add(botId)
    let broken: string | undefined
    try {
      broken = closed ? "bot-core is unloading" : await deps.diagnose(id)
    } catch (error) {
      broken = `its diagnosis failed: ${describe(error)}`
    }
    if (closed || broken !== undefined) {
      await release(dispose, id)
      return fail(botId, template, broken ?? "bot-core is unloading", {
        wasRegistered: true,
        failedDigest: composition.digest,
      })
    }
    const state: BotPresetState = { id, ready: true, template }
    const live: Live = {
      dispose,
      revision: composition.digest,
      hostTools: composition.hostTools,
      revisionToken: composition.revisionToken,
    }
    commit(botId, { live, failedDigest: undefined, state }, true)
    return state
  }

  const refresh = (botId: string, options: { retry?: boolean } = {}) =>
    enqueue(botId, () => realize(botId, options.retry === true))

  const stateOf = (botId: string): BotPresetState | undefined => {
    const entry = entries.get(botId)
    if (entry !== undefined) return entry.state
    const source = deps.source(botId)
    if (source === undefined) return undefined
    return {
      id: botPresetId(botId),
      ready: false,
      template: templateOf(source),
      problem: "the preset is not registered yet",
      pending: true,
    }
  }

  const allIds = () => new Set([...deps.botIds(), ...entries.keys()])

  const touched = new Set<string>()
  let flushing = false
  const unsubscribe = deps.catalog.subscribe((templateId) => {
    touched.add(templateId)
    if (flushing) return
    flushing = true
    schedule(() => {
      flushing = false
      const templates = new Set(touched)
      touched.clear()
      for (const botId of allIds()) {
        const source = deps.source(botId)
        const uses = source !== undefined && templates.has(templateOf(source))
        const used = templates.has(entries.get(botId)?.state.template ?? "")
        if (uses || used) void refresh(botId)
      }
    }, settleMs)
  })

  return {
    refresh,

    async refreshAll() {
      await Promise.all([...allIds()].map((botId) => refresh(botId)))
    },

    run(botId, work) {
      return enqueue(botId, async () => {
        const state = await realize(botId, true)
        if (state === undefined) throw new Error(`bot "${botId}" does not exist`)
        return work(state)
      })
    },

    check,

    preview(botId, source) {
      const template = templateOf(source)
      const result = check(botId, source)
      return result.ok
        ? { ok: true, template, hostTools: result.hostTools }
        : { ok: false, template, problem: result.problem }
    },

    async settled(botId, timeoutMs) {
      let expired = false
      let wake: () => void = () => {}
      const waiter = () => wake()
      waiters.add(waiter)
      const cancel = deps.later(() => {
        expired = true
        wake()
      }, timeoutMs)
      const off = listen((changed) => {
        if (changed === botId) wake()
      })
      try {
        while (!expired && !closed) {
          const queue = queues.get(botId)
          const state = stateOf(botId)
          const pending = state?.ready === false && state.pending === true
          if (queue === undefined && !pending) return
          // Wait for the queued work, a change of this bot, or the deadline.
          await new Promise<void>((resolve) => {
            wake = resolve
            void queue?.then(() => resolve())
          })
        }
      } finally {
        waiters.delete(waiter)
        off()
        cancel()
      }
    },

    state: stateOf,

    registration(botId) {
      const live = entries.get(botId)?.live
      return live === undefined
        ? undefined
        : { revision: live.revision, hostTools: live.hostTools, revisionToken: live.revisionToken }
    },

    isBot(botId) {
      return known.has(botId) || deps.source(botId) !== undefined
    },

    subscribe: listen,

    async dispose() {
      if (closed) return
      closed = true
      for (const waiter of [...waiters]) waiter()
      unsubscribe()
      for (const cancel of [...timers]) cancel()
      timers.clear()
      const registered = [...entries.entries()]
      entries.clear()
      await Promise.all(
        registered.map(([botId, entry]) => release(entry.live?.dispose, botPresetId(botId))),
      )
    },
  }
}
