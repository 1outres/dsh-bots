import type { PanelWidth } from "../files/panel-width"
import type { TimelineImages } from "./images"
import type { TimelinesHub } from "./model"
import type { SessionLogSeats } from "./seats"

export interface MainViewFace {
  readonly timelines: TimelinesHub
  readonly images: TimelineImages
  readonly seats: SessionLogSeats
  readonly width: PanelWidth
}
