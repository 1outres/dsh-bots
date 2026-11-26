import type { BotAvatar } from "../../shared/avatar"
import { type AvatarRasterizer, avatarSource } from "../channels/profile/render"

const SIZE = 64
const KEPT = 64

export function createSpaceAvatars(deps: {
  readonly rasterize: AvatarRasterizer
  avatarOf(botId: string): BotAvatar | undefined
  encodeBase64(bytes: Uint8Array): string
}): (botId: string) => Promise<string> {
  const drawn = new Map<string, Promise<string>>()
  return (botId) => {
    const avatar = deps.avatarOf(botId)
    if (avatar === undefined) return Promise.reject(new Error(`bot "${botId}" does not exist`))
    const key = JSON.stringify(avatar)
    const known = drawn.get(key)
    if (known !== undefined) return known
    const next = deps.rasterize
      .png(avatarSource(avatar, SIZE), SIZE)
      .then((png) => `data:image/png;base64,${deps.encodeBase64(png)}`)
    drawn.set(key, next)
    next.catch(() => {
      if (drawn.get(key) === next) drawn.delete(key)
    })
    for (const oldest of drawn.keys()) {
      if (drawn.size <= KEPT) break
      drawn.delete(oldest)
    }
    return next
  }
}
