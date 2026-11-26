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
  readonly screen: Size
  readonly region: Rect
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

export function toModel(frame: ScreenFrame, point: Point): Point | undefined {
  const x = point.x - frame.region.x
  const y = point.y - frame.region.y
  if (x < 0 || y < 0 || x >= frame.region.width || y >= frame.region.height) return undefined
  return {
    x: Math.floor((x * frame.model.width) / frame.region.width),
    y: Math.floor((y * frame.model.height) / frame.region.height),
  }
}

export function regionToScreen(frame: ScreenFrame, region: Rect): Rect {
  const start = toScreen(frame, region)
  const end = toScreen(frame, {
    x: Math.min(region.x + region.width, frame.model.width) - 1,
    y: Math.min(region.y + region.height, frame.model.height) - 1,
  })
  return { x: start.x, y: start.y, width: end.x - start.x + 1, height: end.y - start.y + 1 }
}

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

  require(): ScreenFrame {
    if (this.latest === undefined)
      throw new ScreenshotRequiredError("no screenshot was taken on this connection")
    return this.latest
  }
}
