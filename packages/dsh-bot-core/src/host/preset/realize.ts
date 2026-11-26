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

export interface BotPresetSource {
  readonly name: string
  readonly template?: string | undefined
  readonly overlay?: unknown
}

export interface PresetRealizerDeps {
  catalog: Pick<TemplateCatalog, "get" | "subscribe">
  source(botId: string): BotPresetSource | undefined
  botIds(): Iterable<string>
  allowedHostTools: ReadonlySet<string>
  web(): WebComposition
  environment: {
    layer(target: { id: string; name: string }): EnvironmentLayer | undefined
    status(
      botId: string,
    ):
      | { readonly ready: true }
      | { readonly ready: false; readonly problem: string; readonly pending?: true }
  }
  seal: Seal
  register(preset: ComposedPreset): Promise<() => Promise<void>>
  diagnose(presetId: string): Promise<string | undefined>
  later(work: () => void, ms: number): () => void
  warn(message: string): void
  graceMs?: number
  settleMs?: number
  duplicateRetryMs?: number
}

export type PresetCheck =
  | CompositionProblem
  | { readonly ok: true; readonly hostTools: readonly string[] }

export interface PresetRegistration {
  readonly revision: string
  readonly hostTools: readonly string[]
  readonly revisionToken: string
}

export interface PresetRealizer {
  refresh(botId: string, options?: { retry?: boolean }): Promise<BotPresetState | undefined>
  refreshAll(): Promise<void>
  run<T>(botId: string, work: (state: BotPresetState) => Promise<T>): Promise<T>
  check(botId: string, source: BotPresetSource): PresetCheck
  preview(botId: string, source: BotPresetSource): BotPresetPreview
  settled(botId: string, timeoutMs: number): Promise<void>
  state(botId: string): BotPresetState | undefined
  registration(botId: string): PresetRegistration | undefined
  isBot(botId: string): boolean
  subscribe(listener: (botId: string) => void): () => void
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
  const known = new Set<string>()
  const queues = new Map<string, Promise<unknown>>()
  const listeners = new Set<(botId: string) => void>()
  const timers = new Set<() => void>()
  const duplicateRetries = new Map<string, number>()
  const pendingTemplates = new Set<string>()
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

  const fail = async (
    botId: string,
    template: string,
    problem: string,
    options: {
      wasRegistered: boolean
      failedDigest?: string
      pending?: boolean
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
