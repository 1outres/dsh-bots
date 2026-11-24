/**
 * The latest screenshot as the model saw it: which part of the screen it
 * shows (in screen pixels) and the size the model got. A model coordinate
 * refers to it; nothing else maps model coordinates to the screen.
 */
export type Size = {
  readonly width: number
  readonly height: number
}

export type Rect = Size & {
  readonly x: number
  readonly y: number
}

export type Point = {
  readonly x: number
  readonly y: number
}

export type ScreenFrame = {
  /** The screen's size when it was taken. */
  readonly screen: Size
  /** The part of the screen it shows. */
  readonly region: Rect
  /** The size the model sees. */
  readonly model: Size
}

export const SCREENSHOT_REQUIRED = "SCREENSHOT_REQUIRED"

export class ScreenshotRequiredError extends Error {
  constructor(reason: string) {
    super(
      `${SCREENSHOT_REQUIRED}: ${reason}; take desktop_screenshot and use its coordinates, or target an element id`,
    )
    this.name = "ScreenshotRequiredError"
  }
}

/** A model coordinate of the frame, as a screen pixel. @throws outside the frame. */
export function toScreen(frame: ScreenFrame, point: Point): Point {
  if (point.x < 0 || point.y < 0 || point.x >= frame.model.width || point.y >= frame.model.height) {
    throw new Error(
      `${point.x},${point.y} is outside the last screenshot (${frame.model.width}x${frame.model.height})`,
    )
  }
  return {
    x: frame.region.x + Math.floor(((point.x + 0.5) * frame.region.width) / frame.model.width),
    y: frame.region.y + Math.floor(((point.y + 0.5) * frame.region.height) / frame.model.height),
  }
}

/** A screen pixel as a model coordinate of the frame, if the frame shows it. */
export function toModel(frame: ScreenFrame, point: Point): Point | undefined {
  const x = point.x - frame.region.x
  const y = point.y - frame.region.y
  if (x < 0 || y < 0 || x >= frame.region.width || y >= frame.region.height) return undefined
  return {
    x: Math.floor((x * frame.model.width) / frame.region.width),
    y: Math.floor((y * frame.model.height) / frame.region.height),
  }
}

/** A rectangle of model coordinates as screen pixels (for a zoomed screenshot). */
export function regionToScreen(frame: ScreenFrame, region: Rect): Rect {
  const start = toScreen(frame, region)
  const end = toScreen(frame, {
    x: Math.min(region.x + region.width, frame.model.width) - 1,
    y: Math.min(region.y + region.height, frame.model.height) - 1,
  })
  return { x: start.x, y: start.y, width: end.x - start.x + 1, height: end.y - start.y + 1 }
}

/** The latest frame of one desktop connection. */
export class FrameMemory {
  private latest: ScreenFrame | undefined

  remember(frame: ScreenFrame): void {
    this.latest = frame
  }

  forget(): void {
    this.latest = undefined
  }

  current(): ScreenFrame | undefined {
    return this.latest
  }

  /** @throws ScreenshotRequiredError when there is none. */
  require(): ScreenFrame {
    if (this.latest === undefined)
      throw new ScreenshotRequiredError("no screenshot was taken on this connection")
    return this.latest
  }
}
