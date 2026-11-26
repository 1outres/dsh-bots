import type { BotChannelProfile, BotProfileImage } from "../../../channel-contract"
import type { BotAvatar } from "../../../shared/avatar"
import type { BotChannelProfileSupport } from "../../../shared/channels"
import { characterSvg, initialSvg } from "./avatar-svg"

export const PROFILE_AVATAR_SIZE = 512
const KEPT_IMAGES = 32

export type AvatarSource =
  | { readonly kind: "svg"; readonly svg: string }
  | { readonly kind: "image"; readonly dataUrl: string }

export interface AvatarRasterizer {
  png(source: AvatarSource, size: number): Promise<Uint8Array>
}

export type Digest = (data: Uint8Array) => string

export interface ProfileBot {
  readonly name: string
  readonly avatar: BotAvatar
}

export interface ProfileRenderer {
  image(avatar: BotAvatar): Promise<BotProfileImage>
  profile(bot: ProfileBot, supports: BotChannelProfileSupport): Promise<BotChannelProfile>
}

export function avatarSource(avatar: BotAvatar, size: number): AvatarSource {
  switch (avatar.kind) {
    case "character":
      return { kind: "svg", svg: characterSvg(avatar, size) }
    case "initial":
      return { kind: "svg", svg: initialSvg(avatar, size) }
    case "image":
      return { kind: "image", dataUrl: avatar.dataUrl }
  }
}

export function profileSourceKey(bot: ProfileBot, supports: BotChannelProfileSupport): string {
  return JSON.stringify([supports.name ? bot.name : null, supports.avatar ? bot.avatar : null])
}

export function createProfileRenderer(deps: {
  rasterize: AvatarRasterizer
  digest: Digest
}): ProfileRenderer {
  const images = new Map<string, Promise<BotProfileImage>>()
  const encoder = new TextEncoder()

  const draw = async (avatar: BotAvatar): Promise<BotProfileImage> => {
    const data = await deps.rasterize.png(
      avatarSource(avatar, PROFILE_AVATAR_SIZE),
      PROFILE_AVATAR_SIZE,
    )
    return { mediaType: "image/png", size: PROFILE_AVATAR_SIZE, data, digest: deps.digest(data) }
  }

  const image = (avatar: BotAvatar): Promise<BotProfileImage> => {
    const key = JSON.stringify(avatar)
    const known = images.get(key)
    if (known !== undefined) return known
    const drawn = draw(avatar)
    images.set(key, drawn)
    drawn.catch(() => {
      if (images.get(key) === drawn) images.delete(key)
    })
    for (const oldest of images.keys()) {
      if (images.size <= KEPT_IMAGES) break
      images.delete(oldest)
    }
    return drawn
  }

  return {
    image,
    async profile(bot, supports) {
      const avatar = supports.avatar ? await image(bot.avatar) : undefined
      const digest = deps.digest(
        encoder.encode(
          JSON.stringify([
            supports.name ? bot.name : null,
            avatar === undefined ? null : avatar.digest,
          ]),
        ),
      )
      return {
        digest,
        ...(supports.name ? { name: bot.name } : {}),
        ...(avatar === undefined ? {} : { avatar }),
      }
    },
  }
}
