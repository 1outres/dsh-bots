import type { BotOverlay, BotTemplate, OverlayOp } from "../shared/preset"

export const overlay = (value: unknown) => value as BotOverlay // rule: 25
export const template = (value: unknown) => value as BotTemplate // rule: 25
export const ops = (value: unknown) => value as readonly OverlayOp[] // rule: 25
