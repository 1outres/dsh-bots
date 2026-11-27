import { describe, expect, it } from "vitest"
import { createInputStaging, type StagingRules } from "../src/host/main-input/staging"
import type { MainInputFailure } from "../src/shared/main-input"

const bytes = (...values: number[]) => new Uint8Array(values)

function setup(rules: Partial<StagingRules> = {}) {
  let now = 1000
  let ids = 0
  const staging = createInputStaging({
    rules: () => ({
      ttlMs: 60_000,
      chunkBytes: 4,
      check: (attachments) =>
        attachments.length > 2
          ? ({ code: "too-many-attachments", message: "two at most" } satisfies MainInputFailure)
          : undefined,
      ...rules,
    }),
    now: () => now,
    newId: () => `s${++ids}`,
  })
  return {
    staging,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe("Main input staging", () => {
  it("stages a file, takes its chunks in order and hands it to a send whole", async () => {
    const { staging } = setup()
    expect(
      staging.stage("a", { draft: "d", name: "n.txt", mediaType: "text/plain", bytes: 6 }),
    ).toEqual({
      staged: true,
      attachmentId: "s1",
    })
    expect(staging.append("a", "s1", 0, bytes(1, 2, 3, 4))).toEqual({
      appended: true,
      received: 4,
      complete: false,
    })
    expect(staging.resolve("a", ["s1"])).toMatchObject({
      ok: false,
      failure: { code: "incomplete-attachment" },
    })
    expect(staging.append("a", "s1", 4, bytes(5, 6))).toEqual({
      appended: true,
      received: 6,
      complete: true,
    })
    const resolved = staging.resolve("a", ["s1"])
    if (!resolved.ok) throw new Error("not resolved")
    const [attachment] = resolved.attachments
    expect(attachment).toMatchObject({ name: "n.txt", mediaType: "text/plain", bytes: 6 })
    expect(await attachment?.read(6, new AbortController().signal)).toEqual(bytes(1, 2, 3, 4, 5, 6))
    await expect(attachment?.read(5, new AbortController().signal)).rejects.toThrow()
    staging.release("a", ["s1"])
    expect(staging.resolve("a", ["s1"])).toMatchObject({ failure: { code: "unknown-attachment" } })
  })

  it("refuses a chunk out of order, too long, or past the declared size", () => {
    const { staging } = setup()
    staging.stage("a", { draft: "d", name: "x", bytes: 5 })
    expect(staging.append("a", "s1", 2, bytes(1))).toMatchObject({
      failure: { code: "incomplete-attachment" },
    })
    expect(staging.append("a", "s1", 0, bytes(1, 2, 3, 4, 5))).toMatchObject({
      failure: { code: "too-large" },
    })
    staging.append("a", "s1", 0, bytes(1, 2, 3, 4))
    expect(staging.append("a", "s1", 4, bytes(1, 2))).toMatchObject({
      failure: { code: "too-large" },
    })
    expect(staging.append("b", "s1", 0, bytes(1))).toMatchObject({
      failure: { code: "unknown-attachment" },
    })
  })

  it("checks a bot's staged set with the new file before taking it", () => {
    const { staging } = setup()
    staging.stage("a", { draft: "d", name: "1", bytes: 0 })
    staging.stage("a", { draft: "d", name: "2", bytes: 0 })
    expect(staging.stage("a", { draft: "d", name: "3", bytes: 0 })).toEqual({
      staged: false,
      failure: { code: "too-many-attachments", message: "two at most" },
    })
    expect(staging.stage("b", { draft: "d", name: "3", bytes: 0 })).toMatchObject({ staged: true })
    expect(staging.stage("a", { draft: "d", name: "bad", bytes: -1 })).toMatchObject({
      staged: false,
    })
  })

  it("forgets what was not touched for the time to live, and what was discarded", () => {
    const { staging, advance } = setup()
    staging.stage("a", { draft: "d", name: "old", bytes: 1 })
    staging.stage("a", { draft: "d", name: "kept", bytes: 1 })
    advance(30_000)
    staging.append("a", "s2", 0, bytes(1))
    advance(30_000)
    expect(staging.resolve("a", ["s2"])).toMatchObject({ ok: true })
    expect(staging.resolve("a", ["s1"])).toMatchObject({ failure: { code: "unknown-attachment" } })
    expect(staging.discard("a", "s2")).toBe(true)
    expect(staging.discard("a", "s2")).toBe(false)
  })

  it("counts the limits per draft, so a draft another page left behind takes no room", () => {
    const { staging } = setup()
    staging.stage("a", { draft: "old", name: "1", bytes: 0 })
    staging.stage("a", { draft: "old", name: "2", bytes: 0 })
    expect(staging.stage("a", { draft: "new", name: "1", bytes: 0 })).toMatchObject({
      staged: true,
    })
    expect(staging.stage("a", { draft: "new", name: "2", bytes: 0 })).toMatchObject({
      staged: true,
    })
    expect(staging.stage("a", { draft: "new", name: "3", bytes: 0 })).toMatchObject({
      staged: false,
    })
  })

  it("refuses an attachment listed twice", () => {
    const { staging } = setup()
    staging.stage("a", { draft: "d", name: "x", bytes: 0 })
    expect(staging.resolve("a", ["s1", "s1"])).toMatchObject({
      failure: { code: "unknown-attachment" },
    })
  })
})
