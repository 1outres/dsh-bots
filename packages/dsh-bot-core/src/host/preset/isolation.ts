/**
 * Tool isolation of bot Agents.
 *
 * Invariant: an Agent of a bot's session runs that bot's preset, and an Agent
 * on a bot's preset belongs to a session of that bot. A session's bot is its
 * identity, not a directory (every bot session runs in the same environment
 * workspace path; see identity.ts): a subagent takes its live parent's
 * identity and nothing else; any other session belongs to the bot its
 * header's `agentPreset` names (fixed at creation, inherited by forks), else
 * to the bot that recorded the session as its own. A subagent whose parent is
 * not live and that bot-core did not record is **unverified** when its header
 * names a bot. Every Agent is classified on `agent/created` and again
 * whenever tools or presets change:
 *
 * - **none**: neither a bot's session nor on a bot preset (a Workspace
 *   Agent). Nothing applies.
 * - **bot**: on bot X's preset in a session of bot X (a subagent inherits its
 *   parent's identity, so it lands here too). It may use the tools of its own
 *   composition and, of the Host's (global) tools, only the `hostTools` of the
 *   revision it started with (a subagent shares its parent's). While the
 *   bot's preset is not registered, no Host tool.
 * - **lockdown**: an unverified session, and any other mix — a bot preset in
 *   a session that is not that bot's (a Workspace Agent's subagent on a bot's
 *   preset), or another preset in a bot's session (a legacy Main created before
 *   bot presets, a blank bot session switched to another preset, a subagent
 *   started under another preset) — and a bot Agent pinned by an earlier
 *   bot-core to a revision from before bot environments (it would run on the
 *   Host). No tool runs.
 *
 * Two mechanisms, both on the Agent's own scope:
 * - The **guard** (`agent.ctx.tools.guard`) is the enforcement: it refuses
 *   every call the verdict does not allow. It reads the Agent's verdict from a
 *   record kept on the Agent itself, so it stays in force when bot-core
 *   unloads (with the last verdict) and a reload takes the record over
 *   instead of adding a second guard.
 * - The **mask** (`agent.ctx.tools.restrict`, a deny list) keeps refused Host
 *   tools out of the model's tool list. It only ever names global tools whose
 *   definition the Agent actually sees (one its preset overrides by name is
 *   left alone), so it never names a tool the registry cannot restrict; it is
 *   re-derived on every change, the new one installed before the old is lifted.
 *
 * Isolation fails closed: when a newly created Agent cannot be classified or
 * its guard or mask installed, {@link BotIsolationError} is thrown from
 * `agent/created` and DSH rolls the Agent's creation back.
 *
 * Nothing here touches DSH directly: every Host interaction is injected.
 */
import { botIdOfPreset } from "../../shared/preset"
import type { SessionIdentity } from "./identity"

/**
 * One tool definition exactly as `tools.definitions(scope?)` returns it (a
 * dsh-tools `ToolDefinition`). Only `name` is read; the object itself is
 * compared by identity to tell the global definition from an override.
 */
export interface ToolEntry {
  readonly name: string
}

export interface IsolationDeps<A extends object> {
  /** Preset the Agent is composed from (`agentPresets.composedPreset(agent.ctx)`). */
  presetOf(agent: A): string | undefined
  /** Whose session the Agent runs (see identity.ts); unverified locks it down. */
  sessionOf(agent: A): SessionIdentity
  /** Whether `botId` is a bot of this bot-core (stored, or seen since start). */
  isBot(botId: string): boolean
  /** The bot's registered preset revision and its host tools; undefined while not registered. */
  registration(
    botId: string,
  ): { readonly revision: string; readonly hostTools: readonly string[] } | undefined
  /** The live Agent that delegated this one, if any (`header.parentSession`). */
  parentOf(agent: A): A | undefined
  /** Every global tool right now (`tools.definitions()`). */
  globalTools(): readonly ToolEntry[]
  /** Every tool the Agent sees right now (`tools.definitions(agent)`). */
  visibleTools(agent: A): readonly ToolEntry[]
  /** Mask tools on the Agent's own scope; returns the exact disposer. */
  restrict(agent: A, deny: readonly string[]): () => void
  /** Install a call guard on the Agent's own scope; returns the exact disposer. */
  guard(agent: A, guard: (tool: string) => string | undefined): () => void
  /** Live Agents (`agents.list()`). */
  agents(): Iterable<A>
  /** Agent id for messages. */
  label(agent: A): string
  warn(message: string): void
}

/** How an Agent is isolated. */
export type Verdict =
  | { readonly kind: "none" }
  | {
      readonly kind: "bot"
      readonly botId: string
      readonly preset: string
      /** Host tools the Agent may use. */
      readonly hostTools: ReadonlySet<string>
    }
  | { readonly kind: "lockdown"; readonly reason: string }

export interface Isolation<A extends object> {
  /**
   * `agent/created`: classify the Agent and install its guard and mask.
   * @throws {BotIsolationError} when that fails; the Agent must not start.
   */
  created(agent: A): void
  /** Re-derive every live Agent's verdict and mask (`tools/change`, a preset change, start-up). */
  resync(): void
  /** Why the Agent may not call `tool` under its current verdict, or undefined. */
  denial(agent: A, tool: string): string | undefined
  /** The Agent's current verdict (classifying it when unknown). */
  verdict(agent: A): Verdict
  /** Stop re-deriving. Guards and masks stay with their Agents' scopes. */
  dispose(): void
}

/** Thrown from `agent/created` so DSH refuses an Agent it could not isolate. */
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

/** The PTC transport tool; its sub-calls pass the guard one by one. */
const RUN_CODE = "run_code"
const NONE: Verdict = { kind: "none" }
/** Echo passes a resync may take before it reports a loop. */
const MAX_PASSES = 5
/**
 * Where an Agent's isolation record lives, on the Agent object itself, so a
 * reloaded bot-core finds the guard and mask an earlier load installed.
 */
const RECORD = Symbol.for("@1outres/dsh-bot-core/isolation")

/** Host tools pinned for an Agent: those of the revision it started with. */
interface Pin {
  readonly preset: string
  readonly revision: string
  readonly hostTools: ReadonlySet<string>
  /**
   * Set on pins of revisions inside the bot's environment (every revision
   * since bot environments). A pin an earlier bot-core left on a live Agent
   * lacks it: that Agent's revision runs its tools on the Host.
   */
  readonly environment?: true
}

interface AgentRecord {
  verdict: Verdict
  /** Preset the mask was derived under. */
  preset: string | undefined
  /** Names of the Agent's own composition (not a global definition), for the guard. */
  own: ReadonlySet<string>
  pin?: Pin | undefined
  maskKey: string
  unmask?: (() => void) | undefined
  unguard?: (() => void) | undefined
}

/** Whether the error says the Agent's scope is already tearing down. */
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

/** Why `record` refuses `tool`, or undefined. */
function refusal(record: AgentRecord, tool: string): string | undefined {
  const { verdict } = record
  if (verdict.kind === "none") return undefined
  if (verdict.kind === "lockdown")
    return `This Agent is locked down by bot-core: ${verdict.reason}.`
  if (tool === RUN_CODE || record.own.has(tool) || verdict.hostTools.has(tool)) return undefined
  return `"${tool}" is a Host tool this bot may not use.`
}

export function createIsolation<A extends object>(deps: IsolationDeps<A>): Isolation<A> {
  // Installing a mask emits tools/change synchronously. Changes that arrive
  // while a pass runs are not dropped: they mark the state dirty, and the
  // pass repeats once it is done (the echo of its own masks settles there).
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

  /** The revision's host tools, pinned on first sight (or taken from the parent). */
  const hostToolsOf = (agent: A, botId: string, preset: string): ReadonlySet<string> => {
    const registration = deps.registration(botId)
    // Not registered: the Agent's revision is no longer the bot's setting.
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
  /** Pins made before the Agent has a record. */
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

  /**
   * The Agent's own tool names (visible with a definition that is not the
   * global one: its preset's, or registered on its own scope) and the mask:
   * every global name it may not use, except names its composition overrides.
   * Global names are always restrictable, and a name the current mask hides
   * stays in the next one, so re-masking never opens a gap.
   */
  const toolsOf = (agent: A, verdict: Verdict): { own: Set<string>; deny: string[] } => {
    const globals = new Map(deps.globalTools().map((tool) => [tool.name, tool]))
    const own = new Set<string>()
    for (const tool of deps.visibleTools(agent)) {
      if (globals.get(tool.name) !== tool) own.add(tool.name)
    }
    if (verdict.kind === "none") return { own, deny: [] }
    // Never a name the composition overrides: masking it would hide the
    // Agent's own tool, and keep hiding it (unseen, it would no longer read as
    // overridden). A locked-down Agent's own tools are refused by the guard.
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

  /** Apply the verdict: record it, guard the Agent, and re-mask it. */
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
      // A new composition: the old mask may hide names the new preset
      // overrides, which would then read as global. The guard takes the new
      // verdict first (it refuses what the verdict refuses meanwhile), then
      // the old mask goes and the new one is derived from a clear view.
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
    // The new mask goes on before the old one is lifted, so there is no gap.
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

  /** Run `work` exclusively, then settle the changes it (or anyone) caused meanwhile. */
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
          // Its preset or session could not be read, so it may be a bot's.
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
