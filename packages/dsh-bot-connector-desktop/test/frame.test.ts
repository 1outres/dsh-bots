import { describe, expect, it } from "vitest"
import { FrameMemory, regionToScreen, type ScreenFrame, toModel, toScreen } from "../src/host/frame"

const full: ScreenFrame = {
  screen: { width: 1280, height: 1024 },
  region: { x: 0, y: 0, width: 1280, height: 1024 },
  model: { width: 1024, height: 819 },
}
const zoomed: ScreenFrame = {
  screen: { width: 1280, height: 1024 },
  region: { x: 100, y: 200, width: 320, height: 160 },
  model: { width: 1280, height: 640 },
}

describe("model coordinates of the latest screenshot", () => {
  it("map to the screen through the model's size", () => {
    expect(toScreen(full, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
    expect(toScreen(full, { x: 512, y: 409 })).toEqual({ x: 640, y: 512 })
    expect(toScreen(full, { x: 1023, y: 818 })).toEqual({ x: 1279, y: 1023 })
  })

  it("map into a zoomed region", () => {
    expect(toScreen(zoomed, { x: 0, y: 0 })).toEqual({ x: 100, y: 200 })
    expect(toScreen(zoomed, { x: 640, y: 320 })).toEqual({ x: 260, y: 280 })
  })

  it("refuse points outside the image", () => {
    expect(() => toScreen(full, { x: 1024, y: 0 })).toThrow(/outside the last screenshot/)
    expect(() => toScreen(full, { x: -1, y: 0 })).toThrow()
  })

  it("map back from the screen, only where the frame shows it", () => {
    expect(toModel(full, { x: 640, y: 512 })).toEqual({ x: 512, y: 409 })
    expect(toModel(zoomed, { x: 260, y: 280 })).toEqual({ x: 640, y: 320 })
    expect(toModel(zoomed, { x: 10, y: 10 })).toBeUndefined()
  })

  it("turn a region of the image into screen pixels", () => {
    expect(regionToScreen(full, { x: 512, y: 0, width: 512, height: 410 })).toEqual({
      x: 640,
      y: 0,
      width: 640,
      height: 513,
    })
  })

  it("need a screenshot first", () => {
    const frames = new FrameMemory()
    expect(() => frames.require()).toThrow(/^SCREENSHOT_REQUIRED/)
    frames.remember(full)
    expect(frames.require()).toBe(full)
    frames.forget()
    expect(frames.current()).toBeUndefined()
  })
})
