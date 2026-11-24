import type { BotStatusChannel, BotStatusConnector, BotStatusFacts } from "../../internal"
import type { BotWebCapability, BotWebCapabilityStatus } from "../../shared/web"

/** Shown for a channel whose settings list no owner (docs/specs/bot-system-prompt.md §5). */
export const NO_OWNER = "no owner listed: nobody there can instruct you as your owner"

function channelState(channel: BotStatusChannel): string {
  const { status } = channel
  switch (status.state) {
    case "off":
      return "off"
    case "incomplete":
      return "settings incomplete"
    case "waiting":
      return "waiting for the bot to be created"
    case "connecting":
      return "connecting"
    case "connected":
      return "connected"
    case "failed":
      return `connection failed: ${status.message}`
  }
}

function channelLine(channel: BotStatusChannel): string {
  const owners = channel.owners.length === 0 ? NO_OWNER : `owners: ${channel.owners.join(", ")}`
  return `${channel.name} (${channelState(channel)}; ${owners})`
}

function connectorLine(connector: BotStatusConnector): string {
  const { readiness } = connector
  switch (readiness.state) {
    case "ready":
      return connector.accounts.length === 0
        ? `${connector.name} (ready)`
        : `${connector.name} (ready; ${connector.accounts.join(", ")})`
    case "preparing":
      return `${connector.name} (preparing)`
    case "disabled":
      return `${connector.name} (off)`
    case "unavailable":
      return `${connector.name} (unavailable: ${readiness.reason})`
    case "failed":
      return `${connector.name} (failed: ${readiness.reason})`
  }
}

function webProblem(
  capability: BotWebCapability,
  status: BotWebCapabilityStatus,
): string | undefined {
  switch (status.state) {
    case "ready":
    case "disabled":
      return undefined
    case "missing-secrets":
      return `${capability} waits for your owner to set the web lookup key`
    case "unavailable":
      return `${capability} is unavailable (${status.reason})`
  }
}

function webLine(web: BotStatusFacts["web"]): string {
  const search = web.search.state === "ready"
  const fetch = web.fetch.state === "ready"
  const usable =
    search && fetch ? "search and fetch" : search ? "search only" : fetch ? "fetch only" : "off"
  const problems = [webProblem("search", web.search), webProblem("fetch", web.fetch)].filter(
    (problem) => problem !== undefined,
  )
  return problems.length === 0 ? usable : `${usable}; ${problems.join("; ")}`
}

const listOrNone = (items: readonly string[]) => (items.length === 0 ? "none" : items.join(", "))

/** The `bot:status` context (docs/specs/bot-system-prompt.md §3). */
export function renderStatus(status: BotStatusFacts): string {
  return [
    "Bot status:",
    `- Chat channels: ${listOrNone(status.channels.map(channelLine))}`,
    `- Connectors: ${listOrNone(status.connectors.map(connectorLine))}`,
    `- Web lookup: ${webLine(status.web)}`,
  ].join("\n")
}
