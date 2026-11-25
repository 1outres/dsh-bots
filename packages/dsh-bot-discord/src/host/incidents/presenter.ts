import type { VaultIncidentView } from "@1outres/dsh-bot-core"
import type { DmRecipient } from "../directory"
import type { DiscordActions } from "../discord"
import type { SerialQueue } from "../queue"
import type { DiscordLocale } from "../texts"
import type { IncidentNotices } from "./records"
import { renderIncidentCard } from "./render"

export interface IncidentPresenterDeps {
  bot: { readonly id: string; readonly name: string }
  actions: Pick<DiscordActions, "send">
  /** Which owner was shown which incident, kept across connections. */
  notices: IncidentNotices
  /** The Discord user ids the settings name as owners. */
  owners: readonly string[]
  /** The owners' DMs (an owner whose DM cannot be opened is left out). */
  recipients(): Promise<readonly DmRecipient[]>
  /** The language of the cards (the notice language). */
  locale: DiscordLocale
  /** Posting, in order with the bridge's other messages. */
  outbound: SerialQueue
  closed(): boolean
}

/**
 * bot-core's credential incidents in the owners' DMs: one card per incident
 * and owner, shown once. bot-core sends an unacknowledged incident again to
 * every new connection; an owner who was shown it is skipped, one whose DM
 * failed gets it next time.
 */
export interface IncidentPresenter {
  /** Rejects when it reached none of the owners that still had to see it. */
  received(incident: VaultIncidentView): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createIncidentPresenter(deps: IncidentPresenterDeps): IncidentPresenter {
  const { notices } = deps

  const show = async (incident: VaultIncidentView) => {
    if (incident.botId !== deps.bot.id) {
      throw new Error(`credential incident ${incident.id} is not of bot ${deps.bot.id}`)
    }
    if (deps.owners.length === 0 || deps.closed()) return
    const recipients = await deps.recipients()
    if (recipients.length === 0) throw new Error("no owner's DM could be opened")
    const due = recipients.filter((recipient) => !notices.shown(incident.id, recipient.userId))
    if (due.length === 0) return
    const card = renderIncidentCard(incident, deps.bot.name, deps.locale)
    const failures: string[] = []
    for (const recipient of due) {
      if (deps.closed()) return
      try {
        const messageId = await deps.actions.send(recipient.channelId, card)
        await notices.save({
          incidentId: incident.id,
          userId: recipient.userId,
          channelId: recipient.channelId,
          messageId,
        })
      } catch (error) {
        failures.push(messageOf(error))
      }
    }
    if (failures.length === due.length) {
      throw new Error(`Discord refused the credential incident: ${failures[0]}`)
    }
  }

  return {
    received: (incident) => deps.outbound.push(() => show(incident)),
  }
}
