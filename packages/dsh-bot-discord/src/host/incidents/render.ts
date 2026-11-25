import type { VaultIncidentView, VaultSecretKind } from "@1outres/dsh-bot-core"
import { literal } from "../actions/render"
import type { DiscordOutgoingMessage } from "../discord"
import { clip } from "../interactions/render"
import type { DiscordLocale } from "../texts"
import { type IncidentTextKey, incidentText } from "./texts"

const LABEL_LIMIT = 200
const TOOL_LIMIT = 100

const ADVICE: { readonly [Kind in VaultSecretKind]: IncidentTextKey } = {
  password: "changePassword",
  passkey: "changePasskey",
  otp: "changeOtp",
}

const timestamp = (at: number, style: "f" | "R") => `<t:${Math.floor(at / 1000)}:${style}>`

function whereOf(incident: VaultIncidentView, locale: DiscordLocale): string {
  const tool =
    incident.tool === undefined
      ? incidentText("anyTool", locale)
      : `**${literal(clip(incident.tool, TOOL_LIMIT))}**`
  switch (incident.source) {
    case "tool-result":
      return incidentText("toolResult", locale, { tool })
    case "tool-arguments":
      return incidentText("toolArguments", locale, { tool })
    case "assistant-message":
      return incidentText("assistantMessage", locale)
    case "inbound-message":
      return incidentText("inboundMessage", locale)
    case "bot-context":
      return incidentText("botContext", locale)
  }
}

function whenOf(incident: VaultIncidentView, locale: DiscordLocale): string {
  const first = `${timestamp(incident.at, "f")} (${timestamp(incident.at, "R")})`
  if (incident.repeats === undefined) return first
  const lastAt = incident.lastAt ?? incident.at
  return `${first}\n${incidentText("repeats", locale, {
    count: String(incident.repeats + 1),
    last: `${timestamp(lastAt, "f")} (${timestamp(lastAt, "R")})`,
  })}`
}

/**
 * A credential incident's card for an owner's DM: the bot, the login and its
 * kind, where and when, the outcome and, once the model read the value, what
 * to change. It names only these fields of the incident.
 */
export function renderIncidentCard(
  incident: VaultIncidentView,
  botName: string,
  locale: DiscordLocale,
): DiscordOutgoingMessage {
  const bot = literal(botName)
  const label = literal(clip(incident.label, LABEL_LIMIT))
  const exposed = incident.outcome === "exposed"
  const lines = [
    `**${incidentText("login", locale)}**: ${label} (${incidentText(incident.kind, locale)})`,
    `**${incidentText("where", locale)}**: ${whereOf(incident, locale)}`,
    `**${incidentText("when", locale)}**: ${whenOf(incident, locale)}`,
    `**${incidentText("outcome", locale)}**: ${incidentText(incident.outcome, locale)}`,
    ...(exposed ? [incidentText(ADVICE[incident.kind], locale, { label })] : []),
    `-# ${incidentText("acknowledge", locale)}`,
  ]
  return {
    content: incidentText(exposed ? "headlineExposed" : "headlineRedacted", locale, { bot }),
    embeds: [{ title: incidentText("title", locale), description: lines.join("\n\n") }],
  }
}
