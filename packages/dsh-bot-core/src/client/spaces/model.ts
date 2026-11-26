import type { BotView } from "../../shared/bots"
import type { BotSpaceView } from "../../shared/spaces"

export const SPACE_PANEL_PREFIX = "bot-core.space."

export const spacePanelId = (space: Pick<BotSpaceView, "botId" | "slug">): string =>
  `${SPACE_PANEL_PREFIX}${space.botId}.${space.slug}`

export const FRAME_REFRESH_LEAD_MS = 10 * 60_000

export const FRAME_REFRESH_MIN_MS = 60_000

export const NEW_TAB_LINK_DAYS = 1

export const LINK_DAYS_CHOICES = [1, 7, 30, 90, 365] as const

const byCreation = (a: BotSpaceView, b: BotSpaceView) =>
  a.createdAt - b.createdAt || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)

export function spacesOfBot(spaces: readonly BotSpaceView[], botId: string): BotSpaceView[] {
  return spaces.filter((space) => space.botId === botId).sort(byCreation)
}

export function spacesByBot(
  spaces: readonly BotSpaceView[],
): Readonly<Record<string, readonly BotSpaceView[]>> {
  const grouped: Record<string, BotSpaceView[]> = {}
  for (const space of [...spaces].sort(byCreation)) {
    const list = grouped[space.botId]
    if (list === undefined) grouped[space.botId] = [space]
    else list.push(space)
  }
  return grouped
}

export const findSpace = (
  spaces: readonly BotSpaceView[],
  spaceId: string,
): BotSpaceView | undefined => spaces.find((space) => space.id === spaceId)

export interface SpaceSlotEntry {
  readonly id: string
  readonly spaceId: string
  readonly botId: string
  readonly label: string
  readonly order: number
  readonly pinned: boolean
}

export function spaceSlotEntries(
  spaces: readonly BotSpaceView[],
  bots: readonly BotView[],
): SpaceSlotEntry[] {
  const grouped = spacesByBot(spaces)
  return [...bots].reverse().flatMap((bot, botIndex) =>
    (grouped[bot.id] ?? []).map((space, index) => ({
      id: spacePanelId(space),
      spaceId: space.id,
      botId: bot.id,
      label: space.title,
      order: 100 + botIndex * 100 + index,
      pinned: space.pinned,
    })),
  )
}

export function frameRefreshDelay(expiresAt: number, now: number): number {
  return Math.max(expiresAt - FRAME_REFRESH_LEAD_MS - now, FRAME_REFRESH_MIN_MS)
}

export function activeSpaceId(
  activePanelId: string | null,
  spaces: readonly BotSpaceView[],
): string | undefined {
  if (activePanelId === null || !activePanelId.startsWith(SPACE_PANEL_PREFIX)) return undefined
  return spaces.find((space) => spacePanelId(space) === activePanelId)?.id
}
