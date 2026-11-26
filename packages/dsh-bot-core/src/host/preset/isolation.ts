import { botIdOfPreset } from "../../shared/preset"
import type { SessionIdentity } from "./identity"

export interface ToolEntry {
  readonly name: string
}

export interface IsolationDeps<A extends object> {
  presetOf(agent: A): string | undefined
  sessionOf(agent: A): SessionIdentity
  isBot(botId: string): boolean
  registration(
    botId: string,
  ): { readonly revision: string; readonly hostTools: readonly string[] } | undefined
  parentOf(agent: A): A | undefined
  globalTools(): readonly ToolEntry[]
  visibleTools(agent: A): readonly ToolEntry[]
  restrict(agent: A, deny: readonly string[]): () => void
  guard(agent: A, guard: (tool: string) => string | undefined): () => void
  agents(): Iterable<A>
  label(agent: A): string
  warn(message: string): void
}

export type Verdict =
  | { readonly kind: "none" }
  | {
      readonly kind: "bot"
      readonly botId: string
      readonly preset: string
      readonly hostTools: ReadonlySet<string>
    }
  | { readonly kind: "lockdown"; readonly reason: string }

export interface Isolation<A extends object> {
  created(agent: A): void
  resync(): void
  denial(agent: A, tool: string): string | undefined
  verdict(agent: A): Verdict
  dispose(): void
}

export class BotIsolationError extends Error {
  constructor(agent: string, preset: string, cause: unknown) {
    super(
      `bot-core: could not isolate Agent "${agent}" (preset "${preset}"), so it is not started: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    )
    this.name = "BotIsolationError"
  }
}

const RUN_CODE = "run_code"
const NONE: Verdict = { kind: "none" }
const MAX_PASSES = 5
const RECORD = Symbol.for("@1outres/dsh-bot-core/isolation")

interface Pin {
  readonly preset: string
  readonly revision: string
  readonly hostTools: ReadonlySet<string>
  readonly environment?: true
}

interface AgentRecord {
  verdict: Verdict
  preset: string | undefined
  own: ReadonlySet<string>
  pin?: Pin | undefined
  maskKey: string
  unmask?: (() => void) | undefined
  unguard?: (() => void) | undefined
}

function isInactive(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "INACTIVE_EFFECT"
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function refusal(record: AgentRecord, tool: string): string | undefined {
  const { verdict } = record
  if (verdict.kind === "none") return undefined
  if (verdict.kind === "lockdown")
    return `This Agent is locked down by bot-core: ${verdict.reason}.`
  if (tool === RUN_CODE || record.own.has(tool) || verdict.hostTools.has(tool)) return undefined
  return `"${tool}" is a Host tool this bot may not use.`
}

export function createIsolation<A extends object>(deps: IsolationDeps<A>): Isolation<A> {
  let busy = false
  let dirty = false
  let closed = false

  const recordOf = (agent: A): AgentRecord | undefined =>
    Reflect.get(agent, RECORD) as AgentRecord | undefined
  const attach = (agent: A, record: AgentRecord) => {
    Object.defineProperty(agent, RECORD, { value: record, configurable: true, enumerable: false })
  }

  const botOfPreset = (preset: string | undefined): string | undefined => {
    if (preset === undefined) return undefined
    const botId = botIdOfPreset(preset)
    return botId !== undefined && deps.isBot(botId) ? botId : undefined
  }

  const hostToolsOf = (agent: A, botId: string, preset: string): ReadonlySet<string> => {
    const registration = deps.registration(botId)
    if (registration === undefined) return new Set()
    const record = recordOf(agent)
    if (record?.pin?.preset === preset) return record.pin.hostTools
    const parent = deps.parentOf(agent)
    const inherited = parent === undefined ? undefined : recordOf(parent)?.pin
    const pin: Pin =
      inherited?.preset === preset
        ? inherited
        : {
            preset,
            revision: registration.revision,
            hostTools: new Set(registration.hostTools),
            environment: true,
          }
    if (record !== undefined) record.pin = pin
    pendingPins.set(agent, pin)
    return pin.hostTools
  }
  const pendingPins = new WeakMap<A, Pin>()

  const classify = (agent: A): Verdict => {
    const preset = deps.presetOf(agent)
    const presetBot = botOfPreset(preset)
    const session = deps.sessionOf(agent)
    if (session.kind === "unverified") return { kind: "lockdown", reason: session.reason }
    const sessionBot = session.kind === "bot" ? session.botId : undefined
    if (presetBot === undefined && sessionBot === undefined) return NONE
    if (presetBot !== undefined && presetBot === sessionBot && preset !== undefined) {
      const pin = recordOf(agent)?.pin
      if (pin?.preset === preset && pin.environment !== true) {
        return {
          kind: "lockdown",
          reason: `it runs a revision of bot "${presetBot}"'s Agent preset from before bot environments, outside the bot's environment`,
        }
      }
      return {
        kind: "bot",
        botId: presetBot,
        preset,
        hostTools: hostToolsOf(agent, presetBot, preset),
      }
    }
    const reason =
      sessionBot === undefined
        ? `it runs bot "${presetBot}"'s Agent preset outside that bot's sessions`
        : `it runs a session of bot "${sessionBot}" under Agent preset "${preset ?? "(none)"}" instead of that bot's preset`
    return { kind: "lockdown", reason }
  }

  const toolsOf = (agent: A, verdict: Verdict): { own: Set<string>; deny: string[] } => {
    const globals = new Map(deps.globalTools().map((tool) => [tool.name, tool]))
    const own = new Set<string>()
    for (const tool of deps.visibleTools(agent)) {
      if (globals.get(tool.name) !== tool) own.add(tool.name)
    }
    if (verdict.kind === "none") return { own, deny: [] }
    const deny = [...globals.keys()].filter(
      (name) => !own.has(name) && (verdict.kind === "lockdown" || !verdict.hostTools.has(name)),
    )
    return { own, deny: deny.sort() }
  }

  const lift = (agent: A, unmask: (() => void) | undefined) => {
    try {
      unmask?.()
    } catch (error) {
      if (!isInactive(error)) {
        deps.warn(
          `bot-core: could not lift an old tool mask of "${deps.label(agent)}": ${describe(error)}`,
        )
      }
    }
  }

  const apply = (agent: A, verdict: Verdict) => {
    const preset = deps.presetOf(agent)
    let record = recordOf(agent)
    if (record === undefined) {
      if (verdict.kind === "none") return
      record = { verdict, preset, own: new Set(), pin: pendingPins.get(agent), maskKey: "" }
      attach(agent, record)
    }
    const target = record
    if (target.unguard === undefined && verdict.kind !== "none") {
      target.unguard = deps.guard(agent, (tool) => refusal(target, tool))
    }
    if (target.preset !== preset) {
      target.verdict = verdict
      target.own = new Set()
      target.preset = preset
      const unmask = target.unmask
      target.unmask = undefined
      target.maskKey = ""
      lift(agent, unmask)
    }
    const { own, deny } = toolsOf(agent, verdict)
    const key = deny.join("\n")
    if (key !== target.maskKey) {
      const unmask = deny.length === 0 ? undefined : deps.restrict(agent, deny)
      const previous = target.unmask
      target.unmask = unmask
      target.maskKey = key
      lift(agent, previous)
    }
    target.verdict = verdict
    target.own = own
  }

  const pass = () => {
    for (const agent of deps.agents()) {
      try {
        apply(agent, classify(agent))
      } catch (error) {
        if (isInactive(error)) continue
        deps.warn(
          `bot-core: could not update the isolation of "${deps.label(agent)}"; its previous mask and guard stay: ${describe(error)}`,
        )
      }
    }
  }

  const exclusive = (work: () => void) => {
    busy = true
    try {
      work()
      let passes = 0
      while (dirty && !closed) {
        dirty = false
        if (++passes > MAX_PASSES) {
          deps.warn("bot-core: tool masks kept changing; stopped re-deriving them for now")
          break
        }
        pass()
      }
    } finally {
      busy = false
    }
  }

  return {
    created(agent) {
      if (closed) return
      exclusive(() => {
        let verdict: Verdict
        try {
          verdict = classify(agent)
        } catch (error) {
          throw new BotIsolationError(deps.label(agent), "unknown", error)
        }
        try {
          apply(agent, verdict)
        } catch (error) {
          throw new BotIsolationError(
            deps.label(agent),
            verdict.kind === "bot" ? verdict.preset : (deps.presetOf(agent) ?? "unknown"),
            error,
          )
        }
        if (verdict.kind === "lockdown") {
          deps.warn(`bot-core: Agent "${deps.label(agent)}" is locked down: ${verdict.reason}`)
        }
      })
    },

    resync() {
      if (closed) return
      dirty = true
      if (busy) return
      exclusive(() => {})
    },

    denial(agent, tool) {
      const record = recordOf(agent)
      if (record !== undefined) return refusal(record, tool)
      const verdict = classify(agent)
      return verdict.kind === "none"
        ? undefined
        : refusal(
            { verdict, preset: undefined, own: toolsOf(agent, verdict).own, maskKey: "" },
            tool,
          )
    },

    verdict(agent) {
      return recordOf(agent)?.verdict ?? classify(agent)
    },

    dispose() {
      closed = true
    },
  }
}
