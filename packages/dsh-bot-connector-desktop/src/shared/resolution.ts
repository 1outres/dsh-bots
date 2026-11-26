import type { ConnectorSettingValues } from "@1outres/dsh-bot-core"

export interface Resolution {
  readonly width: number
  readonly height: number
}

export function parseResolution(value: unknown): Resolution {
  const match =
    typeof value === "string" ? /^([1-9][0-9]{2,3})x([1-9][0-9]{2,3})$/.exec(value) : null
  if (match === null) throw new Error(`"${String(value)}" is not a screen size`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

export function resolutionOf(settings: ConnectorSettingValues): Resolution {
  return parseResolution(settings.resolution)
}
