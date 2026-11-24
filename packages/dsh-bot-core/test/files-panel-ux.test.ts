import { describe, expect, it } from "vitest"
import { createPanelFocus } from "../src/client/files/panel-focus"
import {
  clampWidth,
  MIN_WIDTH,
  separatorKeyWidth,
  WIDTH_STEP,
  widthBounds,
} from "../src/client/files/panel-width"
import { createViewer } from "../src/client/viewer"

describe("panel focus", () => {
  it("hands one pending move to the view that draws its target, once", () => {
    const focus = createPanelFocus()
    expect(focus.take("preview")).toBe(false)
    focus.request("preview")
    expect(focus.take("browser")).toBe(false)
    expect(focus.take("preview")).toBe(true)
    expect(focus.take("preview")).toBe(false)
    focus.request("preview")
    focus.request("browser")
    expect(focus.take("preview")).toBe(false)
    expect(focus.take("browser")).toBe(true)
  })
})

describe("panel width bounds and the separator's keys", () => {
  it("bounds the width from the minimum to 70% of the shell", () => {
    expect(widthBounds(1000)).toEqual({ min: MIN_WIDTH, max: 700 })
    expect(widthBounds(300)).toEqual({ min: MIN_WIDTH, max: MIN_WIDTH })
    expect(clampWidth(900, 1000)).toBe(700)
    expect(clampWidth(100, 1000)).toBe(MIN_WIDTH)
  })

  it("widens with ←, narrows with →, and jumps to the bounds with Home and End", () => {
    const bounds = widthBounds(1000)
    expect(separatorKeyWidth("ArrowLeft", 400, bounds)).toBe(400 + WIDTH_STEP)
    expect(separatorKeyWidth("ArrowRight", 400, bounds)).toBe(400 - WIDTH_STEP)
    expect(separatorKeyWidth("Home", 400, bounds)).toBe(MIN_WIDTH)
    expect(separatorKeyWidth("End", 400, bounds)).toBe(700)
    expect(separatorKeyWidth("Enter", 400, bounds)).toBeUndefined()
  })
})

describe("viewer: the file shown last", () => {
  it("is kept through going back and documents, for the browser to mark", () => {
    const viewer = createViewer()
    expect(viewer.of("s1").lastFile).toBeUndefined()
    viewer.openFile("s1", "dir/a.ts", 3)
    viewer.browse("s1")
    expect(viewer.of("s1")).toEqual({
      open: true,
      content: { kind: "browse" },
      lastFile: "dir/a.ts",
    })
    viewer.showDocument("s1", "Plan", "# x")
    viewer.close("s1")
    viewer.browse("s1")
    expect(viewer.of("s1").lastFile).toBe("dir/a.ts")
    viewer.openFile("s1", "b.md")
    expect(viewer.of("s1").lastFile).toBe("b.md")
  })
})
