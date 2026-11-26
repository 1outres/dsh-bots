import type { ConnectorSettingValues } from "@1outres/dsh-bot-core"

/** The desktop's screen size, in pixels. */
export interface Resolution {
  readonly width: number
  readonly height: number
}

/** @throws when the value is not a size like 1280x1024. */
export function parseResolution(value: unknown): Resolution {
  const match =
    typeof value === "string" ? /^([1-9][0-9]{2,3})x([1-9][0-9]{2,3})$/.exec(value) : null
  if (match === null) throw new Error(`"${String(value)}" is not a screen size`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** The screen size a bot's settings of the desktop ask for. */
export function resolutionOf(settings: ConnectorSettingValues): Resolution {
  return parseResolution(settings.resolution)
}
