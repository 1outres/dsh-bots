import type { BotSettingsArea } from "../../../settings-contract"
import type { BotChannelText } from "../../../shared/channels"
import type { BotEnvironmentSpec } from "../../../shared/environment"
import type { MainRotationSettings } from "../../../shared/mains"
import type {
  BotSettingApplyResult,
  BotSettingEntry,
  BotSettingJson,
} from "../../../shared/settings"
import type { BotWebCapabilityStatus, BotWebStatus } from "../../../shared/web"
import { BOT_SETTINGS_PLACE, GLOBAL_SETTINGS_PLACE, placeIn } from "./common"

const READ_ONLY: BotSettingApplyResult = {
  applied: false,
  reason: {
    en: "these settings are read only for you",
    ja: "この設定はボットからは変えられません",
  },
}

interface ReadOnlyEntry {
  readonly key: string
  readonly label: BotChannelText
  readonly note: string
  readonly raw: BotSettingJson
  readonly shown: BotChannelText
}

function readOnlyArea(
  id: string,
  label: BotChannelText,
  location: BotChannelText,
  read: (botId: string) => readonly ReadOnlyEntry[],
): BotSettingsArea {
  return {
    id,
    label,
    location,
    entries: async (botId) =>
      read(botId).map(
        (entry): BotSettingEntry => ({
          key: entry.key,
          label: entry.label,
          agentNote: entry.note,
          value: { raw: entry.raw, shown: entry.shown },
          change: "never",
        }),
      ),
    implied: () => [],
    apply: async () => READ_ONLY,
  }
}

const plain = (en: string): BotChannelText => ({ en })

const NONE: BotChannelText = { en: "None", ja: "なし" }

const listed = (items: readonly string[]): BotChannelText =>
  items.length === 0 ? NONE : plain(items.join(", "))

export function createLoginsArea(deps: {
  logins(botId: string): readonly { readonly label: string; readonly kinds: readonly string[] }[]
}): BotSettingsArea {
  const label: BotChannelText = { en: "Logins", ja: "ログイン情報" }
  return readOnlyArea("logins", label, placeIn(BOT_SETTINGS_PLACE, label), (botId) => {
    const logins = deps.logins(botId)
    return [
      {
        key: "logins",
        label,
        note: "The logins your owner gave you from a password manager, by name and what each holds; use them with your login tools, never by reading the values.",
        raw: logins.map((login) => login.label),
        shown: listed(logins.map((login) => `${login.label} (${login.kinds.join(", ")})`)),
      },
    ]
  })
}

const SPEC_LABELS = {
  cpus: { en: "CPUs", ja: "CPU" },
  memoryMiB: { en: "Memory (MiB)", ja: "メモリ（MiB）" },
  diskGiB: { en: "Disk (GiB)", ja: "ディスク（GiB）" },
} as const

export function createEnvironmentArea(deps: {
  spec(botId: string): BotEnvironmentSpec | undefined
}): BotSettingsArea {
  const label: BotChannelText = { en: "VM", ja: "VM" }
  return readOnlyArea("environment", label, placeIn(BOT_SETTINGS_PLACE, label), (botId) => {
    const spec = deps.spec(botId)
    return (Object.keys(SPEC_LABELS) as (keyof typeof SPEC_LABELS)[]).map((key) => ({
      key,
      label: SPEC_LABELS[key],
      note: "The size of your Linux machine; your owner changes it, and the VM restarts for it.",
      raw: spec?.[key] ?? null,
      shown:
        spec === undefined
          ? { en: "Not read yet", ja: "まだ読めていません" }
          : plain(String(spec[key])),
    }))
  })
}

export function createWorkspacesArea(deps: {
  workspaces(botId: string): readonly string[]
}): BotSettingsArea {
  const label: BotChannelText = { en: "Workspaces", ja: "ワークスペース" }
  return readOnlyArea("workspaces", label, placeIn(BOT_SETTINGS_PLACE, label), (botId) => {
    const titles = deps.workspaces(botId)
    return [
      {
        key: "granted",
        label,
        note: "The DeepSeek Harness Workspaces your owner lets you start sessions in (session_start with that Workspace as target).",
        raw: titles,
        shown: listed(titles),
      },
    ]
  })
}

const onOff = (enabled: boolean, detail: string): BotChannelText =>
  enabled ? { en: `On, ${detail}`, ja: `オン、${detail}` } : { en: "Off", ja: "オフ" }

export function createMainsArea(deps: {
  effective(botId: string): MainRotationSettings
}): BotSettingsArea {
  const label: BotChannelText = { en: "Main session", ja: "Main セッション" }
  return readOnlyArea("mains", label, placeIn(BOT_SETTINGS_PLACE, label), (botId) => {
    const settings = deps.effective(botId)
    const note =
      "When your Main session is compacted or replaced by a new one; it happens only while you are idle."
    return [
      {
        key: "quietMinutes",
        label: { en: "Quiet before maintenance (minutes)", ja: "手入れまでの静かな時間（分）" },
        note,
        raw: settings.quietMinutes,
        shown: plain(String(settings.quietMinutes)),
      },
      {
        key: "idleCompaction",
        label: { en: "Compact when idle", ja: "空いているときに圧縮" },
        note,
        raw: settings.idleCompaction.enabled,
        shown: onOff(
          settings.idleCompaction.enabled,
          `${settings.idleCompaction.minUsagePercent}%`,
        ),
      },
      {
        key: "daily",
        label: { en: "New Main session every day", ja: "毎日新しい Main セッション" },
        note,
        raw: settings.daily.enabled,
        shown: onOff(settings.daily.enabled, settings.daily.time),
      },
      {
        key: "longIdle",
        label: {
          en: "New Main session after a long pause",
          ja: "長く空いたら新しい Main セッション",
        },
        note,
        raw: settings.longIdle.enabled,
        shown: onOff(settings.longIdle.enabled, `${settings.longIdle.minutes} min`),
      },
      {
        key: "compactions",
        label: {
          en: "New Main session after compactions",
          ja: "圧縮が続いたら新しい Main セッション",
        },
        note,
        raw: settings.compactions.enabled,
        shown: onOff(settings.compactions.enabled, String(settings.compactions.count)),
      },
      {
        key: "memoryFlush",
        label: { en: "Write notes before", ja: "前にノートを書く" },
        note: "Whether you get a turn to write your notes before a compaction or a new Main session.",
        raw: settings.memoryFlush.enabled,
        shown: settings.memoryFlush.enabled ? { en: "On", ja: "オン" } : { en: "Off", ja: "オフ" },
      },
    ]
  })
}

function webShown(status: BotWebCapabilityStatus): BotChannelText {
  switch (status.state) {
    case "ready":
      return { en: "Ready", ja: "使えます" }
    case "disabled":
      return { en: "Off", ja: "オフ" }
    case "missing-secrets":
      return { en: "Waiting for an API key", ja: "API キーを待っています" }
    case "unavailable":
      return { en: "Unavailable", ja: "使えません" }
  }
}

export function createWebArea(deps: { status(): BotWebStatus }): BotSettingsArea {
  const label: BotChannelText = { en: "Web lookup", ja: "Web 検索・フェッチ" }
  return readOnlyArea("web", label, placeIn(GLOBAL_SETTINGS_PLACE, label), () => {
    const status = deps.status()
    return [
      {
        key: "search",
        label: { en: "Search", ja: "検索" },
        note: "Whether web_search works for you; shared by every bot.",
        raw: status.search.state,
        shown: webShown(status.search),
      },
      {
        key: "fetch",
        label: { en: "Fetch", ja: "フェッチ" },
        note: "Whether web_fetch works for you; shared by every bot.",
        raw: status.fetch.state,
        shown: webShown(status.fetch),
      },
    ]
  })
}
