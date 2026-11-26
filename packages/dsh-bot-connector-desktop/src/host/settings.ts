import type { ConnectorSettingField } from "@1outres/dsh-bot-core"

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
    agent: {
      note: "The size of your desktop's screen; changing it restarts the desktop session and closes its applications.",
      change: "approve",
    },
    options: RESOLUTIONS.map((value) => ({ value, label: { en: value.replace("x", "×") } })),
  },
]
