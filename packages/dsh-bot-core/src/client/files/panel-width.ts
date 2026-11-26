import type { Observable } from "../observable"
import { createPersistentValue } from "../persistent-value"

export const MIN_WIDTH = 280
export const DEFAULT_WIDTH = 420
export const WIDTH_STEP = 16
const MAX_SHARE = 0.7

export interface WidthBounds {
  readonly min: number
  readonly max: number
}

export function widthBounds(available: number): WidthBounds {
  return { min: MIN_WIDTH, max: Math.max(MIN_WIDTH, Math.floor(available * MAX_SHARE)) }
}

export function clampWidth(width: number, available: number): number {
  const { min, max } = widthBounds(available)
  return Math.min(Math.max(Math.round(width), min), max)
}

export function separatorKeyWidth(
  key: string,
  width: number,
  bounds: WidthBounds,
): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return width + WIDTH_STEP
    case "ArrowRight":
      return width - WIDTH_STEP
    case "Home":
      return bounds.min
    case "End":
      return bounds.max
    default:
      return undefined
  }
}

function parseWidth(stored: unknown): number {
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored < MIN_WIDTH) {
    throw new Error(`not a panel width: ${JSON.stringify(stored)}`)
  }
  return stored
}

export interface PanelWidth extends Observable<number> {
  resize(width: number, available: number): void
}

export interface PanelWidthOptions {
  readonly key: string
  readonly initial: number
}

export const FILES_PANEL_WIDTH: PanelWidthOptions = {
  key: "dsh-bots:files-width",
  initial: DEFAULT_WIDTH,
}

export const CONNECTOR_PANEL_WIDTH: PanelWidthOptions = {
  key: "dsh-bots:connector-panel-width",
  initial: 720,
}

export const NOTES_PANEL_WIDTH: PanelWidthOptions = {
  key: "dsh-bots:notes-width",
  initial: 480,
}

export const SESSION_LOG_PANEL_WIDTH: PanelWidthOptions = {
  key: "dsh-bots:session-log-width",
  initial: 640,
}

export const ACTIONS_PANEL_WIDTH: PanelWidthOptions = {
  key: "dsh-bots:actions-width",
  initial: DEFAULT_WIDTH,
}

export function createPanelWidth(options: PanelWidthOptions): PanelWidth {
  const width = createPersistentValue({
    key: options.key,
    parse: parseWidth,
    initial: options.initial,
  })
  return {
    getSnapshot: width.getSnapshot,
    subscribe: width.subscribe,
    resize: (next, available) => width.set(clampWidth(next, available)),
  }
}
