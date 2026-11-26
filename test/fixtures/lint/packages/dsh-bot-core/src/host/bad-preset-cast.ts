import type { BotOverlay, BotTemplate, OverlayOp } from "../shared/preset"

export const overlay = (value: unknown) => value as BotOverlay
export const template = (value: unknown) => value as BotTemplate
export const ops = (value: unknown) => value as readonly OverlayOp[]
