/**
 * The desktop's per-bot settings: the screen size.
 */
import type { ConnectorSettingField, ConnectorSettingValues } from "@1outres/dsh-bot-core"

export interface Resolution {
  readonly width: number
  readonly height: number
}

const RESOLUTIONS = ["1280x1024", "1280x800"] as const

export const DESKTOP_SETTINGS: readonly ConnectorSettingField[] = [
  {
    key: "resolution",
    kind: "choice",
    label: { en: "Screen size", ja: "画面サイズ" },
    description: {
      en: "Changing it restarts the desktop session: open applications close.",
      ja: "変えるとデスクトップのセッションが再起動し、開いているアプリは閉じます。",
    },
    default: "1280x1024",
    options: RESOLUTIONS.map((value) => ({ value, label: { en: value.replace("x", "×") } })),
  },
]

/** @throws when the value is not a size like 1280x1024. */
export function parseResolution(value: unknown): Resolution {
  const match =
    typeof value === "string" ? /^([1-9][0-9]{2,3})x([1-9][0-9]{2,3})$/.exec(value) : null
  if (match === null) throw new Error(`"${String(value)}" is not a screen size`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

export function resolutionOf(settings: ConnectorSettingValues): Resolution {
  return parseResolution(settings.resolution)
}
