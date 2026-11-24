// Tests may cast malformed input to exercise validation.
import type { BotOverlay } from "../src/shared/preset"

export const malformed = [{ op: "nope" }] as unknown as BotOverlay
export const direct = {} as BotOverlay
