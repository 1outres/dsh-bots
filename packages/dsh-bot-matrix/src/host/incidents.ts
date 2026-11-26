import type { VaultIncidentView } from "@1outres/dsh-bot-core"
import { escapeMarkdown } from "./format/markdown"
import type { SerialQueue } from "./queue"
import type { IncidentRecords } from "./records/incidents"
import type { RoomPoster } from "./room"
import { fill, type MatrixLocale, type Texts } from "./texts"

const TEXTS = {
  exposed: {
    en: "⚠️ **{bot} may have exposed a login**",
    ja: "⚠️ **{bot} がログイン情報を漏らした可能性があります**",
  },
  redacted: {
    en: "🛡️ **{bot} kept a login from leaking**",
    ja: "🛡️ **{bot} のログイン情報の漏洩を防ぎました**",
  },
  login: { en: "Login", ja: "ログイン" },
  where: { en: "Where", ja: "場所" },
  when: { en: "When", ja: "日時" },
  change: {
    en: "Change this login's secret ({label}) now.",
    ja: "このログイン（{label}）の秘密を今すぐ変更してください。",
  },
  acknowledge: {
    en: "Mark it as seen in the bot's settings in the Web UI.",
    ja: "Web UI のボットの設定で確認済みにしてください。",
  },
} as const satisfies Record<string, Texts>

export function renderIncident(
  incident: VaultIncidentView,
  bot: string,
  locale: MatrixLocale,
): string {
  const exposed = incident.outcome === "exposed"
  const label = escapeMarkdown(incident.label)
  return [
    fill(exposed ? TEXTS.exposed : TEXTS.redacted, locale, { bot: escapeMarkdown(bot) }),
    "",
    `- **${fill(TEXTS.login, locale)}**: ${label} (${incident.kind})`,
    `- **${fill(TEXTS.where, locale)}**: ${incident.source}${incident.tool === undefined ? "" : ` · ${escapeMarkdown(incident.tool)}`}`,
    `- **${fill(TEXTS.when, locale)}**: ${new Date(incident.at).toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ...(exposed ? ["", fill(TEXTS.change, locale, { label })] : []),
    "",
    fill(TEXTS.acknowledge, locale),
  ].join("\n")
}

export function createIncidentPresenter(deps: {
  readonly bot: { readonly id: string; readonly name: string }
  readonly poster: RoomPoster
  readonly records: IncidentRecords
  roomId(): Promise<string>
  readonly locale: MatrixLocale
  readonly outbound: SerialQueue
  closed(): boolean
}) {
  return {
    received: (incident: VaultIncidentView) =>
      deps.outbound.push(async () => {
        if (incident.botId !== deps.bot.id)
          throw new Error(`credential incident ${incident.id} is not of bot ${deps.bot.id}`)
        if (deps.closed() || deps.records.shown(incident.id)) return
        const roomId = await deps.roomId()
        const eventId = await deps.poster.text(renderIncident(incident, deps.bot.name, deps.locale))
        await deps.records.save({ incidentId: incident.id, roomId, eventId })
      }),
  }
}
