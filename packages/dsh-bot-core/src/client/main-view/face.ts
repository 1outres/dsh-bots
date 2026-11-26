import type { PanelWidth } from "../files/panel-width"
import type { TimelineImages } from "./images"
import type { TimelinesHub } from "./model"
import type { SessionLogSeats } from "./seats"

/** What the Main view and its Session log panel read. */
export interface MainViewFace {
  readonly timelines: TimelinesHub
  readonly images: TimelineImages
  readonly seats: SessionLogSeats
  /** The Session log panel's width. */
  readonly width: PanelWidth
}
