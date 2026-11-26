import type { BotSpaceView } from "../../shared/spaces"
import type { BotFlagStore } from "../bot-flags"
import type { PanelInfo } from "../dsh/layout"
import type { MenuPoint } from "../menu"
import type { Observable } from "../observable"
import type { BotsState } from "../session-classification"
import type { SpacesState } from "./feed"
import type { SpaceConfirm, SpaceFlows } from "./flows"
import type { SpaceFrame } from "./frame"

export type SpaceSettingsIntent = "link"

export interface SpacesFace {
  readonly feed: Observable<SpacesState>
  readonly bots: Observable<BotsState>
  readonly panel: Observable<PanelInfo>
  readonly flows: SpaceFlows
  readonly confirm: SpaceConfirm
  readonly spacesExpansion: BotFlagStore
  readonly menuSpace: Observable<string | undefined>
  openSpace(space: BotSpaceView): void
  openSpaceSettings(space: BotSpaceView, intent?: SpaceSettingsIntent): void
  openSpaceMenu(space: BotSpaceView, point: MenuPoint): void
  openFrame(spaceId: string): SpaceFrame
  readonly errors: Observable<Readonly<Record<string, string>>>
  run(space: BotSpaceView, action: () => Promise<unknown>): void
  clearError(spaceId: string): void
}
