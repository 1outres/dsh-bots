import type { BotStatusChannel, BotStatusConnector, BotStatusFacts } from "../../internal"
import type { BotWebCapability, BotWebCapabilityStatus } from "../../shared/web"
import { headerHandle, headerName } from "../channels/header"

export const NO_OWNER = "no owner listed: nobody there can instruct you as your owner"

function channelState(channel: BotStatusChannel): string {
  const { status } = channel
  switch (status.state) {
    case "off":
      return "off"
    case "unconfigured":
      return "not set up in dsh-bots settings yet"
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

function ownersText(channel: BotStatusChannel): string {
  if (channel.owners.length === 0) return NO_OWNER
  const people = channel.status.state === "connected" ? (channel.status.people ?? {}) : {}
  const named = channel.owners.flatMap((id) => {
    const person = people[id]
    return person === undefined
      ? []
      : [`${headerName(person.displayName)} (@${headerHandle(person.handle)})`]
  })
  const unnamed = channel.owners.length - named.length
  if (named.length === 0) return `owners: ${unnamed} listed, names known once connected`
  const rest = unnamed === 0 ? [] : [`${unnamed} more whose names are unknown`]
  return `owners: ${[...named, ...rest].join(", ")}`
}

function channelLine(channel: BotStatusChannel): string {
  return `${channel.name} (${channelState(channel)}; ${ownersText(channel)})`
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

export function renderStatus(status: BotStatusFacts): string {
  return [
    "Bot status:",
    `- Chat channels: ${listOrNone(status.channels.map(channelLine))}`,
    `- Connectors: ${listOrNone(status.connectors.map(connectorLine))}`,
    `- Web lookup: ${webLine(status.web)}`,
  ].join("\n")
}
