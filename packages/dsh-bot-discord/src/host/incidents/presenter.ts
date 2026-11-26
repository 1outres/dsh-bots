import type { VaultIncidentView } from "@1outres/dsh-bot-core"
import type { DiscordActions } from "../discord"
import type { HomeTarget } from "../home-target"
import type { SerialQueue } from "../queue"
import type { DiscordLocale } from "../texts"
import type { IncidentNotices } from "./records"
import { renderIncidentCard } from "./render"

export interface IncidentPresenterDeps {
  bot: { readonly id: string; readonly name: string }
  actions: Pick<DiscordActions, "send">
  /** Which incidents the home was shown, kept across connections. */
  notices: IncidentNotices
  home: HomeTarget
  /** The language of the cards (the notice language). */
  locale: DiscordLocale
  /** Posting, in order with the bridge's other messages. */
  outbound: SerialQueue
  closed(): boolean
}

/**
 * bot-core's credential incidents at the home: one card per incident, shown
 * once. bot-core sends an unacknowledged incident again to every new
 * connection; one the home was shown is skipped, one that could not be
 * posted is posted next time.
 */
export interface IncidentPresenter {
  /** Rejects when the card could not be posted. */
  received(incident: VaultIncidentView): Promise<void>
}

export function createIncidentPresenter(deps: IncidentPresenterDeps): IncidentPresenter {
  const { notices } = deps

  const show = async (incident: VaultIncidentView) => {
    if (incident.botId !== deps.bot.id) {
      throw new Error(`credential incident ${incident.id} is not of bot ${deps.bot.id}`)
    }
    if (deps.closed() || notices.shown(incident.id)) return
    const home = await deps.home.channel()
    const card = renderIncidentCard(incident, deps.bot.name, deps.locale)
    const messageId = await deps.actions.send(home.channelId, card)
    await notices.save({ incidentId: incident.id, channelId: home.channelId, messageId })
  }

  return {
    received: (incident) => deps.outbound.push(() => show(incident)),
  }
}
