import type {
  BotChannelLink,
  ConnectorActionState,
  ConnectorActionView,
} from "@1outres/dsh-bot-core"
import { APPROVE, REJECT } from "../cards/keys"
import type { MatrixApi } from "../matrix"
import type { SerialQueue } from "../queue"
import type { ActionRecords } from "../records/cards"
import type { RoomPoster } from "../room"
import type { MatrixLocale } from "../texts"
import { actionText, type DigestEntry, renderActionCard, renderDigest } from "./render"

export interface ActionPresenterDeps {
  readonly link: Pick<
    BotChannelLink,
    "decide" | "pendingActions" | "openActions" | "connectorAction"
  > & {
    readonly bot: { readonly name: string }
  }
  readonly api: Pick<MatrixApi, "state" | "putState">
  readonly poster: RoomPoster
  readonly records: ActionRecords
  roomId(): Promise<string>
  readonly self: string
  readonly locale: MatrixLocale
  readonly outbound: SerialQueue
  readonly signal: AbortSignal
  closed(): boolean
  warn(message: string): void
}

export interface ActionPresenter {
  start(): Promise<void>
  received(view: ConnectorActionView): Promise<void>
  react(target: string, key: string, sender: string): boolean
  pending(person: string): string
}

const OPEN: ReadonlySet<ConnectorActionState> = new Set(["pending", "approved", "executing"])
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createActionPresenter(deps: ActionPresenterDeps): ActionPresenter {
  const { records, poster, locale, link } = deps
  const warned = new Set<string>()
  let shown: string | undefined
  const guard = (what: string) => (error: unknown) => {
    if (!deps.closed()) deps.warn(`bot-matrix: could not ${what}: ${messageOf(error)}`)
  }
  const render = (view: ConnectorActionView) => renderActionCard(view, deps.self, locale)

  const finish = async (actionId: string, markdown: string) => {
    const card = records.card(actionId)
    if (card === undefined) return
    await poster.edit(card.eventId, markdown)
    for (const seed of card.seeds) await poster.redact(seed).catch(guard("take back a reaction"))
    await records.forgetCard(actionId)
  }

  const show = async (view: ConnectorActionView) => {
    const card = records.card(view.id)
    if (!OPEN.has(view.status.state)) {
      await finish(view.id, render(view))
      return
    }
    if (card !== undefined) {
      await poster.edit(card.eventId, render(view))
      if (view.status.state !== "pending") {
        for (const seed of card.seeds)
          await poster.redact(seed).catch(guard("take back a reaction"))
        await records.saveCard({ ...card, seeds: [] })
      }
      return
    }
    if (
      view.status.state !== "pending" ||
      link.connectorAction(view.id)?.status.state !== "pending"
    )
      return
    const roomId = await deps.roomId()
    const eventId = await poster.text(render(view))
    const seeds = [await poster.react(eventId, APPROVE), await poster.react(eventId, REJECT)]
    await records.saveCard({ actionId: view.id, roomId, eventId, seeds })
  }

  const entries = (actions: readonly ConnectorActionView[]): DigestEntry[] =>
    actions.map((action) => {
      const card = records.card(action.id)
      return {
        action,
        ...(card === undefined ? {} : { card: { roomId: card.roomId, eventId: card.eventId } }),
      }
    })

  const pin = async (roomId: string, eventId: string) => {
    try {
      const current = await deps.api.state(roomId, "m.room.pinned_events", "", deps.signal)
      const pinned = Array.isArray(current?.pinned)
        ? current.pinned.filter((id): id is string => typeof id === "string")
        : []
      if (!pinned.includes(eventId)) {
        await deps.api.putState(
          roomId,
          "m.room.pinned_events",
          "",
          { pinned: [...pinned, eventId] },
          deps.signal,
        )
      }
      return true
    } catch (error) {
      guard("pin the pending approvals list; it is kept up to date unpinned")(error)
      return false
    }
  }

  const refresh = async () => {
    const markdown = renderDigest(link.bot.name, entries(link.openActions()), locale)
    const digest = records.digest()
    if (digest === undefined) {
      const roomId = await deps.roomId()
      const eventId = await poster.text(markdown)
      shown = markdown
      await records.saveDigest({ roomId, eventId, pinned: await pin(roomId, eventId) })
      return
    }
    if (shown !== markdown) {
      await poster.edit(digest.eventId, markdown)
      shown = markdown
    }
  }

  const settle = async () => {
    for (const card of records.cards()) {
      const view = link.connectorAction(card.actionId)
      if (view !== undefined && OPEN.has(view.status.state)) continue
      await finish(
        card.actionId,
        view === undefined ? actionText("gone", locale) : render(view),
      ).catch(guard("update a connector action"))
    }
  }

  const decide = async (actionId: string, key: string, sender: string) => {
    const decision = key === APPROVE ? "approve" : "reject"
    const result = await link.decide(actionId, decision, sender)
    if (result.accepted || result.reason === "settled") {
      await deps.outbound.push(async () => {
        await show(result.action)
        await refresh()
      })
      return
    }
    if (result.reason === "not-approver" && !warned.has(`${actionId}:${sender}`)) {
      warned.add(`${actionId}:${sender}`)
      const card = records.card(actionId)
      await deps.outbound.push(async () => {
        await poster.notice(actionText("notApprover", locale), card?.eventId)
      })
    }
  }

  return {
    start: () =>
      deps.outbound.push(async () => {
        if (deps.closed()) return
        await settle()
        await refresh().catch(guard("update the pending approvals list"))
      }),
    received: (view) =>
      deps.outbound.push(async () => {
        if (deps.closed()) return
        await show(view).catch(guard("show a connector action"))
        await refresh().catch(guard("update the pending approvals list"))
      }),
    react(target, key, sender) {
      if (key !== APPROVE && key !== REJECT) return records.byEvent(target) !== undefined
      const card = records.byEvent(target)
      if (card === undefined) return false
      decide(card.actionId, key, sender).catch(guard("take a decision on a connector action"))
      return true
    },
    pending(person) {
      const result = link.pendingActions(person)
      if (!result.ok)
        return actionText(result.reason === "closed" ? "closing" : "pendingNotApprover", locale)
      return renderDigest(link.bot.name, entries(result.actions), locale)
    },
  }
}
