import { describe, expect, it, vi } from "vitest"
import type { ScopeBinding } from "../src/client/dsh/session"
import { mainSession } from "../src/client/main-session"
import { value } from "./support/client"

describe("mainSession", () => {
  it("is the session the renderer's session scope is bound to (uiSession.adapter.current)", () => {
    const current = value<ScopeBinding>({})
    const main = mainSession({ adapter: { current } })
    expect(main.getSnapshot()).toBeUndefined()
    const listener = vi.fn()
    const off = main.subscribe(listener)
    current.set({ key: "m1" })
    expect(main.getSnapshot()).toBe("m1")
    expect(listener).toHaveBeenCalledTimes(1)
    current.set({ key: 42 })
    expect(main.getSnapshot()).toBeUndefined()
    off()
    current.set({ key: "m2" })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
