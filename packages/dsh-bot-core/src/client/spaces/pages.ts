import type { SpaceSettingsIntent } from "./face"

export const SPACES_SECTION = "bot-core.spaces"

export const SPACES_GLOBAL_SECTION = "bot-core.spaces"

export interface SpaceDetail {
  readonly spaceId: string
  readonly intent: SpaceSettingsIntent | undefined
}

const SPACE_DETAIL = "space:"
const LINK_DETAIL = "link:"

export const spaceDetailOf = (spaceId: string, intent?: SpaceSettingsIntent): string =>
  `${intent === "link" ? LINK_DETAIL : SPACE_DETAIL}${spaceId}`

export function parseSpaceDetail(detail: string | null): SpaceDetail | undefined {
  if (detail === null) return undefined
  if (detail.startsWith(LINK_DETAIL)) {
    return { spaceId: detail.slice(LINK_DETAIL.length), intent: "link" }
  }
  if (detail.startsWith(SPACE_DETAIL)) {
    return { spaceId: detail.slice(SPACE_DETAIL.length), intent: undefined }
  }
  return undefined
}
