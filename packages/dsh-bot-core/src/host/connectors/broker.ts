import type { BotConnectorTrigger } from "../../connector-contract"
import { connectionName } from "../../shared/connections"
import {
  type ConnectorAction,
  type ConnectorActionState,
  type ConnectorDecision,
  type ConnectorDecisionOrigin,
  type ConnectorJson,
  type ConnectorPreparationStage,
  type ConnectorPreview,
  type ConnectorReadiness,
  isTerminalActionState,
} from "../../shared/connectors"
import type { ConnectorAccounts } from "../connections/accounts"
import type { ConnectionRecord } from "../connections/domain"
import { isOpen } from "./action"
import type { CatalogTool, ConnectorCatalog } from "./catalog"
import type { Deadlines } from "./deadlines"
import type { ExclusiveRuns } from "./exclusive"
import { type ExecutionOutcome, runConnectorTool, takeSnapshot } from "./execution"
import type { ConnectorLedger } from "./ledger"
import type { ConnectorPermissions } from "./permissions"
import type { ConnectorReadinessKeeper } from "./readiness"
import type { ConnectorRuns } from "./runs"
import {
  awaitingReply,
  type ConnectorNotice,
  type ConnectorToolReply,
  cancelledReply,
  doneReply,
  endedNotice,
  endedReply,
  pendingListReply,
} from "./texts"

export interface ConnectorCall {
  readonly botId: string
  readonly sessionId: string
  readonly connectorId: string
  readonly tool: string
  readonly args: ConnectorJson
}

export interface ConnectorDecisionRequest {
  readonly botId: string
  readonly actionId: string
  readonly decision: ConnectorDecision
  readonly origin: ConnectorDecisionOrigin
}

export type ConnectorDecisionOutcome =
  | { readonly ok: true; readonly action: ConnectorAction }
  | { readonly ok: false; readonly code: "not-found" }
  | {
      readonly ok: false
      readonly code: "settled"
      readonly state: ConnectorActionState
      readonly action: ConnectorAction
    }

export interface ConnectorBrokerDeps {
  catalog: Pick<ConnectorCatalog, "tool" | "subscribe">
  permissions: Pick<ConnectorPermissions, "effective">
  ledger: ConnectorLedger
  deadlines: Deadlines
  readiness: Pick<ConnectorReadinessKeeper, "state" | "subscribe">
  runs: Pick<ConnectorRuns, "prepare">
  accounts: Pick<ConnectorAccounts, "resolve" | "pinned">
  exclusive: ExclusiveRuns
  operated(botId: string, connector: CatalogTool["connector"]): string | undefined
  shield<T>(botId: string, tool: string, value: T): Promise<T>
  notify(botId: string, notice: ConnectorNotice): Promise<void>
  newId(): string
  now(): number
  later(ms: number, work: () => void): () => void
  readonly retentionMs: number
  warn(message: string): void
}

export function preparationStageText(stage: ConnectorPreparationStage): string {
  switch (stage.kind) {
    case "requirements":
      return `waiting for ${stage.connectors.join(", ")} to be ready`
    case "queued":
      return "waiting for another preparation of the bot"
    case "running":
      return stage.step ?? "starting"
  }
}

export function notReadyReason(name: string, readiness: ConnectorReadiness): string | undefined {
  switch (readiness.state) {
    case "ready":
      return undefined
    case "disabled":
      return `${name} is not enabled for this bot`
    case "unavailable":
      return `${name} cannot run now: ${readiness.reason}`
    case "preparing":
      return `${name} is being prepared for this bot (${preparationStageText(readiness.stage)}); try again in a while`
    case "failed":
      return `${name} could not be prepared for this bot: ${readiness.reason}`
  }
}

export function userInControl(operated: string, entry: CatalogTool): string {
  return `USER_IN_CONTROL: a person is operating this bot's ${operated}, which ${entry.connector.name} works on, so ${entry.name} did not run. Its reading tools still work; wait until they hand it back, then look again (the page may have changed).`
}

export interface ConnectorBroker {
  call(call: ConnectorCall, signal: AbortSignal): Promise<ConnectorToolReply>
  recordDecision(request: ConnectorDecisionRequest): Promise<ConnectorDecisionOutcome>
  cancel(botId: string, actionId: string): Promise<ConnectorToolReply>
  pending(botId: string): ConnectorToolReply
  recover(): Promise<void>
  prune(keep: (botId: string) => boolean): Promise<void>
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function previewProblem(preview: unknown): string | undefined {
  if (typeof preview !== "object" || preview === null) return "the preview is not an object"
  const { title, fields, body } = preview as Partial<Record<keyof ConnectorPreview, unknown>>
  if (typeof title !== "string" || title.trim() === "") return "the preview has no title"
  if (body !== undefined && typeof body !== "string") return "the preview body is not text"
  if (
    !Array.isArray(fields) ||
    !fields.every(
      (field: unknown) =>
        typeof field === "object" &&
        field !== null &&
        typeof (field as { label?: unknown }).label === "string" &&
        typeof (field as { value?: unknown }).value === "string",
    )
  ) {
    return "the preview fields are not label/value texts"
  }
  return undefined
}

export function createConnectorBroker(deps: ConnectorBrokerDeps): ConnectorBroker {
  const { ledger } = deps
  const lifetime = new AbortController()
  const attendance = new Map<string, number>()
  const uncollected = new Set<string>()
  const waiters = new Map<string, Set<() => void>>()
  const running = new Set<string>()

  const send = (action: ConnectorAction) => {
    const notice = endedNotice(action)
    if (notice === undefined) return
    deps.notify(action.botId, notice).catch((error: unknown) => {
      deps.warn(
        `bot-core: could not queue the notice of connector action "${action.id}": ${messageOf(error)}`,
      )
    })
  }

  const attend = (actionId: string) => {
    attendance.set(actionId, (attendance.get(actionId) ?? 0) + 1)
    let released = false
    return (collected: boolean) => {
      if (released) return
      released = true
      const left = (attendance.get(actionId) ?? 1) - 1
      if (left > 0) attendance.set(actionId, left)
      else attendance.delete(actionId)
      if (collected) uncollected.delete(actionId)
      if (left > 0 || !uncollected.delete(actionId)) return
      const action = ledger.get(actionId)
      if (action !== undefined) send(action)
    }
  }

  const expire = (actionId: string) => {
    ledger.advance(actionId, { kind: "expire", at: deps.now() })
  }

  const abandon = (actionId: string) => {
    ledger.advance(actionId, {
      kind: "fail",
      at: deps.now(),
      reason:
        "its connector was not registered and ready before the action expired, so it did not run",
    })
  }

  const run = async (
    entry: CatalogTool,
    botId: string,
    args: ConnectorJson,
    trigger: BotConnectorTrigger,
    signal: AbortSignal,
    callerSessionId?: string,
    connection?: ConnectionRecord,
  ): Promise<ExecutionOutcome> => {
    const work = async (): Promise<ExecutionOutcome> => {
      const operated =
        entry.tool.readOnly === true ? undefined : deps.operated(botId, entry.connector)
      if (operated !== undefined) return { ok: false, reason: userInControl(operated, entry) }
      const prepared = await deps.runs.prepare(botId, entry, trigger, signal, {
        kind: "execute",
        ...(callerSessionId === undefined ? {} : { callerSessionId }),
        ...(connection === undefined ? {} : { connection }),
      })
      try {
        return await runConnectorTool(entry, args, prepared)
      } finally {
        prepared.release()
      }
    }
    const key = entry.tool.exclusive
    try {
      return await (key === undefined
        ? work()
        : deps.exclusive.run(`${botId}\u0000${entry.connector.id}\u0000${key}`, signal, work))
    } catch (error) {
      return { ok: false, reason: messageOf(error) }
    }
  }

  const execute = async (action: ConnectorAction, entry: CatalogTool) => {
    const started = ledger.advance(action.id, { kind: "start", at: deps.now() })
    if (started?.ok !== true) return
    const fail = (reason: string) => {
      ledger.advance(action.id, { kind: "fail", at: deps.now(), reason })
    }
    try {
      await started.stored
    } catch {
      fail("bot-core could not record that the action started, so it did not run")
      return
    }
    let connection: ConnectionRecord | undefined
    if (entry.connector.connections !== undefined) {
      if (action.connectionId === undefined) {
        fail("the action names no account, so it did not run")
        return
      }
      const pinned = deps.accounts.pinned(action.botId, entry.connector, action.connectionId)
      if (!pinned.ok) {
        fail(`${pinned.reason}, so it did not run`)
        return
      }
      connection = pinned.connection
    }
    if (
      deps.permissions.effective(
        action.botId,
        action.connectorId,
        action.tool,
        action.connectionId,
      ) === "disallow"
    ) {
      fail("the tool is disallowed for this bot now, so it did not run")
      return
    }
    const decision =
      started.action.status.state === "executing" ? started.action.status.decision : undefined
    const trigger: BotConnectorTrigger = {
      kind: "approval",
      actionId: action.id,
      approvedAt: decision?.at ?? deps.now(),
      ...(action.snapshot === undefined ? {} : { snapshot: action.snapshot }),
    }
    const outcome = await run(
      entry,
      action.botId,
      action.args,
      trigger,
      lifetime.signal,
      undefined,
      connection,
    )
    if (lifetime.signal.aborted && !outcome.ok) return
    let kept: ExecutionOutcome
    try {
      kept = await deps.shield(action.botId, entry.name, outcome)
    } catch {
      fail("its result could not be checked by the vault guard, so it was not kept")
      return
    }
    ledger.advance(
      action.id,
      kept.ok
        ? {
            kind: "succeed",
            at: deps.now(),
            result: kept.output.data,
            ...(kept.output.text === undefined ? {} : { text: kept.output.text }),
          }
        : { kind: "fail", at: deps.now(), reason: kept.reason },
    )
  }

  const runApproved = (actionId: string) => {
    const action = ledger.get(actionId)
    if (action?.status.state !== "approved" || running.has(actionId)) return
    const entry = deps.catalog.tool(action.connectorId, action.tool)
    if (entry === undefined) return
    if (deps.readiness.state(action.botId, action.connectorId).state !== "ready") return
    running.add(actionId)
    void execute(action, entry)
      .catch((error: unknown) => {
        deps.warn(`bot-core: connector action "${actionId}" did not run: ${messageOf(error)}`)
      })
      .finally(() => running.delete(actionId))
  }

  const track = (action: ConnectorAction) => {
    switch (action.status.state) {
      case "pending":
        deps.deadlines.arm(action.id, action.expiresAt, () => expire(action.id))
        return
      case "approved":
        deps.deadlines.arm(action.id, action.expiresAt, () => abandon(action.id))
        runApproved(action.id)
        return
      default:
        deps.deadlines.disarm(action.id)
    }
  }

  const offLedger = ledger.subscribe(({ action }) => {
    track(action)
    for (const wake of [...(waiters.get(action.id) ?? [])]) wake()
    if (!isTerminalActionState(action.status.state)) return
    if ((attendance.get(action.id) ?? 0) > 0) uncollected.add(action.id)
    else send(action)
  })
  const offCatalog = deps.catalog.subscribe(() => {
    for (const action of ledger.all()) {
      if (action.status.state === "approved") runApproved(action.id)
    }
  })
  const offReadiness = deps.readiness.subscribe((botId, connectorId) => {
    for (const action of ledger.list(botId)) {
      if (action.status.state === "approved" && action.connectorId === connectorId) {
        runApproved(action.id)
      }
    }
  })

  const wait = async (actionId: string, until: number, signal: AbortSignal) => {
    const release = attend(actionId)
    const onAbort = () => release(false)
    signal.addEventListener("abort", onAbort, { once: true })
    try {
      for (;;) {
        const action = ledger.get(actionId)
        if (action === undefined) throw new Error(`connector action "${actionId}" is gone`)
        if (isTerminalActionState(action.status.state)) {
          release(true)
          return action
        }
        const pending = action.status.state === "pending"
        if (signal.aborted || lifetime.signal.aborted || (pending && deps.now() >= until)) {
          return action
        }
        await new Promise<void>((resolve) => {
          const set = waiters.get(actionId) ?? new Set<() => void>()
          waiters.set(actionId, set)
          let cancelTimer = () => {}
          const wake = () => {
            set.delete(wake)
            if (set.size === 0) waiters.delete(actionId)
            cancelTimer()
            signal.removeEventListener("abort", wake)
            resolve()
          }
          set.add(wake)
          if (pending) cancelTimer = deps.later(Math.max(0, until - deps.now()), wake)
          signal.addEventListener("abort", wake, { once: true })
        })
      }
    } finally {
      signal.removeEventListener("abort", onAbort)
      release(false)
    }
  }

  const ask = async (
    entry: CatalogTool,
    call: ConnectorCall,
    signal: AbortSignal,
    connection: ConnectionRecord | undefined,
  ) => {
    let action = ledger.pendingTwin(
      call.botId,
      call.connectorId,
      call.tool,
      call.args,
      connection?.id,
    )
    if (action === undefined) {
      let snapshot: ConnectorJson | undefined
      if (entry.tool.snapshot !== undefined) {
        const prepared = await deps.runs.prepare(call.botId, entry, { kind: "call" }, signal, {
          kind: "snapshot",
          callerSessionId: call.sessionId,
          ...(connection === undefined ? {} : { connection }),
        })
        try {
          snapshot = await deps.shield(
            call.botId,
            entry.name,
            await takeSnapshot(entry, call.args, prepared.run),
          )
        } catch (error) {
          throw new Error(
            `${entry.name} could not read what this call concerns: ${messageOf(error)}`,
          )
        } finally {
          prepared.release()
        }
      }
      let described: ConnectorPreview
      try {
        described = entry.tool.preview(entry.split(call.args).own as never, snapshot)
      } catch (error) {
        throw new Error(`${entry.name} could not describe this call: ${messageOf(error)}`)
      }
      const problem = previewProblem(described)
      if (problem !== undefined) throw new Error(`${entry.name}: ${problem}`)
      const preview: ConnectorPreview =
        connection === undefined
          ? described
          : {
              ...described,
              fields: [
                { label: "Account", value: connectionName(connection) },
                ...described.fields,
              ],
            }
      const now = deps.now()
      action = {
        id: deps.newId(),
        botId: call.botId,
        connectorId: call.connectorId,
        tool: call.tool,
        args: call.args,
        preview,
        ...(snapshot === undefined ? {} : { snapshot }),
        ...(connection === undefined ? {} : { connectionId: connection.id }),
        sessionId: call.sessionId,
        createdAt: now,
        expiresAt: now + entry.ttlMs,
        status: { state: "pending" },
      }
      await ledger.create(action)
      track(action)
    }
    const until = Math.min(deps.now() + entry.waitMs, action.expiresAt)
    const settled = await wait(action.id, until, signal)
    return isTerminalActionState(settled.status.state)
      ? endedReply(settled)
      : awaitingReply(settled)
  }

  return {
    async call(call, signal) {
      const entry = deps.catalog.tool(call.connectorId, call.tool)
      if (entry === undefined)
        throw new Error(`connector "${call.connectorId}" has no tool "${call.tool}" registered now`)
      const problems = entry.check(call.args)
      if (problems.length > 0) throw new Error(`invalid arguments: ${problems.join("; ")}`)
      const unready = notReadyReason(
        entry.connector.name,
        deps.readiness.state(call.botId, call.connectorId),
      )
      if (unready !== undefined) throw new Error(unready)
      let connection: ConnectionRecord | undefined
      if (entry.connector.connections !== undefined) {
        const account = entry.split(call.args).account
        if (account === undefined) throw new Error("invalid arguments: account is missing")
        const resolved = deps.accounts.resolve(call.botId, entry.connector, account)
        if (!resolved.ok) throw new Error(resolved.reason)
        connection = resolved.connection
      }
      const permission = deps.permissions.effective(
        call.botId,
        call.connectorId,
        call.tool,
        connection?.id,
      )
      if (permission === undefined || permission === "disallow") {
        throw new Error(
          connection === undefined
            ? `${entry.name} is not available to this bot`
            : `${entry.name} is not available to this bot as ${connectionName(connection)}: the user disallowed it for that account in the bot's Connectors settings`,
        )
      }
      if (permission === "ask") return ask(entry, call, signal, connection)
      const outcome = await run(
        entry,
        call.botId,
        call.args,
        { kind: "call" },
        signal,
        call.sessionId,
        connection,
      )
      if (!outcome.ok) throw new Error(outcome.reason)
      return doneReply(entry.name, outcome.output)
    },
    async recordDecision(request) {
      const current = ledger.get(request.actionId)
      if (current === undefined || current.botId !== request.botId) {
        return { ok: false, code: "not-found" }
      }
      const transition = ledger.advance(request.actionId, {
        kind: request.decision,
        origin: request.origin,
        at: deps.now(),
      })
      if (transition === undefined) return { ok: false, code: "not-found" }
      if (!transition.ok) {
        return { ok: false, code: "settled", state: transition.from, action: current }
      }
      await transition.stored.catch(() => {})
      return { ok: true, action: ledger.get(request.actionId) ?? transition.action }
    },
    async cancel(botId, actionId) {
      const current = ledger.get(actionId)
      if (current === undefined || current.botId !== botId) {
        throw new Error(`no connector action "${actionId}" of this bot`)
      }
      const transition = ledger.advance(actionId, { kind: "cancel", at: deps.now() })
      if (transition === undefined || !transition.ok) {
        throw new Error(
          `connector action "${actionId}" is ${current.status.state}, so it cannot be cancelled`,
        )
      }
      await transition.stored.catch(() => {})
      return cancelledReply(transition.action)
    },
    pending: (botId) => pendingListReply(ledger.list(botId).filter(isOpen)),
    async recover() {
      for (const action of ledger.all()) {
        if (action.status.state === "executing") {
          ledger.advance(action.id, { kind: "interrupt", at: deps.now() })
        } else {
          track(action)
        }
      }
    },
    prune: (keep) => ledger.prune(deps.now() - deps.retentionMs, keep),
    dispose() {
      lifetime.abort()
      offLedger()
      offCatalog()
      offReadiness()
      deps.deadlines.dispose()
      for (const set of waiters.values()) for (const wake of [...set]) wake()
    },
  }
}
