import { afterEach, describe, expect, it, vi } from "vitest"
import { BotFileError, type BotFileFailure } from "../src/client/file-failure"
import type { BotFilesClient } from "../src/client/files"
import { createSessionModels } from "../src/client/files/files-face"
import { createPanelWidth, DEFAULT_WIDTH, FILES_PANEL_WIDTH } from "../src/client/files/panel-width"
import { createPreviewModel } from "../src/client/files/preview-model"
import { createSearchModel, SEARCH_DELAY_MS, type Timers } from "../src/client/files/search-model"
import { createTreeModel } from "../src/client/files/tree-model"
import type { BotFileSearchResult, BotFileText } from "../src/shared/files"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function client(overrides: Partial<BotFilesClient>): BotFilesClient {
  const refuse = () =>
    Promise.reject(new BotFileError({ kind: "connection", message: "not faked" }))
  return {
    stat: refuse,
    read: refuse,
    readBytes: refuse,
    list: refuse,
    search: refuse,
    ...overrides,
  }
}

const text = (offset: number, lines: string[], eof: boolean): BotFileText => ({
  absolutePath: "/w/a.ts",
  version: "v",
  offset,
  text: lines.join("\n"),
  lines: lines.length,
  eof,
})

/** A call that settles only when the test says so, recording its signal. */
function deferred<T>() {
  const calls: { signal: AbortSignal; resolve(value: T): void; reject(error: unknown): void }[] = []
  const run = (signal: AbortSignal | undefined) =>
    new Promise<T>((resolve, reject) => {
      if (signal === undefined) throw new Error("signal expected")
      calls.push({ signal, resolve, reject })
    })
  return { calls, run }
}

function fakeTimers(): Timers & { advance(ms: number): void; pending(): number } {
  let now = 0
  let next = 0
  const queue = new Map<number, { at: number; run: () => void }>()
  return {
    set(run, delay) {
      next += 1
      queue.set(next, { at: now + delay, run })
      return next
    },
    clear(handle) {
      queue.delete(handle as number)
    },
    advance(ms) {
      now += ms
      for (const [id, timer] of [...queue]) {
        if (timer.at > now) continue
        queue.delete(id)
        timer.run()
      }
    },
    pending: () => queue.size,
  }
}

const found = (...paths: string[]): BotFileSearchResult => ({
  matches: paths.map((path) => ({ path, type: "file" as const })),
  truncated: false,
  incomplete: false,
})

describe("the preview model", () => {
  it("loads a request, and a newer one aborts the older", async () => {
    const pending = deferred<BotFileText>()
    const model = createPreviewModel(
      client({ read: (_s, _p, _r, signal) => pending.run(signal) }),
      "b1",
    )
    const first = { path: "a.ts", revision: 1 }
    const second = { path: "a.ts", revision: 2 }
    model.load(first)
    expect(model.getSnapshot()).toEqual({ status: "loading", request: first })
    model.load(second)
    expect(pending.calls[0]?.signal.aborted).toBe(true)
    pending.calls[0]?.resolve(text(1, ["old"], true))
    pending.calls[1]?.resolve(text(1, ["new"], true))
    await settle()
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      request: second,
      preview: { kind: "text", lines: ["new"] },
      extension: { status: "idle" },
    })
  })

  it.each<[string, unknown, BotFileFailure]>([
    [
      "a Host refusal",
      new BotFileError({ kind: "host", code: "bot-file/not-found", message: "gone" }),
      { kind: "host", code: "bot-file/not-found", message: "gone" },
    ],
    [
      "a broken connection",
      new BotFileError({ kind: "connection", message: "socket closed" }),
      { kind: "connection", message: "socket closed" },
    ],
    [
      "a failed mount",
      new BotFileError({ kind: "mount", message: "no remote" }),
      { kind: "mount", message: "no remote" },
    ],
  ])("fails with %s", async (_name, error, failure) => {
    const model = createPreviewModel(client({ read: () => Promise.reject(error) }), "b1")
    model.load({ path: "a.ts", revision: 1 })
    await settle()
    expect(model.getSnapshot()).toEqual({
      status: "failed",
      request: { path: "a.ts", revision: 1 },
      failure,
    })
  })

  it("reads a rejection outside the client's contract as a protocol failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const raw = new TypeError("not a BotFileError")
    const model = createPreviewModel(client({ read: () => Promise.reject(raw) }), "b1")
    model.load({ path: "a.ts", revision: 1 })
    await settle()
    expect(model.getSnapshot()).toMatchObject({
      status: "failed",
      failure: {
        kind: "protocol",
        violation: { kind: "foreign-rejection" },
        message: "not a BotFileError",
        raw,
      },
    })
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("foreign-rejection"), raw)
    consoleError.mockRestore()
  })

  it("extends a text page and keeps it when extending fails", async () => {
    let fail = false
    const read = vi.fn(async (_s: string, _p: string, range?: { offset?: number }) => {
      if (fail) throw new BotFileError({ kind: "connection", message: "down" })
      return text(range?.offset ?? 1, ["x"], false)
    })
    const model = createPreviewModel(client({ read }), "b1")
    model.load({ path: "a.ts", revision: 1 })
    await settle()
    model.extend("after")
    expect(model.getSnapshot()).toMatchObject({
      extension: { status: "loading", direction: "after" },
    })
    await settle()
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      preview: { lines: ["x", "x"] },
      extension: { status: "idle" },
    })
    fail = true
    model.extend("after")
    await settle()
    expect(model.getSnapshot()).toMatchObject({
      status: "ready",
      preview: { lines: ["x", "x"] },
      extension: { status: "failed", direction: "after", failure: { kind: "connection" } },
    })
  })

  it("cancels the call in flight and goes back to idle", async () => {
    const pending = deferred<BotFileText>()
    const model = createPreviewModel(
      client({ read: (_s, _p, _r, signal) => pending.run(signal) }),
      "b1",
    )
    model.load({ path: "a.ts", revision: 1 })
    model.cancel()
    expect(pending.calls[0]?.signal.aborted).toBe(true)
    expect(model.getSnapshot()).toEqual({ status: "idle" })
    pending.calls[0]?.resolve(text(1, ["late"], true))
    await settle()
    expect(model.getSnapshot()).toEqual({ status: "idle" })
  })
})

describe("the tree model", () => {
  it("lists the root, then each directory on first expansion, and lists them again on refresh", async () => {
    const list = vi.fn(async (_s: string, path: string) => ({
      path,
      entries:
        path === ""
          ? [
              { name: "src", type: "directory" as const },
              { name: ".env", type: "file" as const, size: 3 },
            ]
          : [{ name: "a.ts", type: "file" as const }],
      truncated: path === "src",
    }))
    const tree = createTreeModel(client({ list }), "b1")
    tree.load()
    tree.load()
    expect(tree.getSnapshot().directories[""]).toEqual({ status: "loading" })
    await settle()
    expect(tree.getSnapshot().entries.map((row) => row.path)).toEqual(["src", ".env"])
    expect(tree.getSnapshot().entries[1]?.meta).toEqual({ kind: "file", hidden: true, size: 3 })
    tree.toggle("src", true)
    await settle()
    expect(tree.getSnapshot()).toMatchObject({
      expanded: ["src"],
      directories: {
        "": { status: "listed", truncated: false },
        src: { status: "listed", truncated: true },
      },
    })
    expect(tree.getSnapshot().entries.map((row) => row.path)).toContain("src/a.ts")
    tree.toggle("src", false)
    expect(tree.getSnapshot().entries.map((row) => row.path)).not.toContain("src/a.ts")
    tree.toggle("src", true)
    expect(list).toHaveBeenCalledTimes(2)
    tree.refresh()
    await settle()
    expect(list).toHaveBeenCalledTimes(4)
    tree.dispose()
  })

  it("reports a directory that cannot be listed with its failure", async () => {
    const failure: BotFileFailure = {
      kind: "host",
      code: "bot-file/permission-denied",
      message: "no",
    }
    const tree = createTreeModel(
      client({ list: () => Promise.reject(new BotFileError(failure)) }),
      "b1",
    )
    tree.load()
    await settle()
    expect(tree.getSnapshot().directories[""]).toEqual({ status: "failed", failure })
  })

  it("aborts listings on dispose and ignores them after", async () => {
    const pending = deferred<{ path: string; entries: []; truncated: false }>()
    const tree = createTreeModel(client({ list: (_s, _p, signal) => pending.run(signal) }), "b1")
    tree.load()
    tree.dispose()
    expect(pending.calls[0]?.signal.aborted).toBe(true)
    tree.load()
    tree.refresh()
    expect(pending.calls).toHaveLength(1)
  })
})

describe("the search model", () => {
  it("searches the trimmed query once it has stopped changing for the debounce delay", async () => {
    const timers = fakeTimers()
    const search = vi.fn(async () => found("a/b.ts"))
    const model = createSearchModel(client({ search }), "b1", timers)
    model.setQuery("b")
    model.setQuery("b.")
    expect(model.getSnapshot()).toEqual({ query: "b.", result: { status: "loading", term: "b." } })
    timers.advance(SEARCH_DELAY_MS - 1)
    expect(search).not.toHaveBeenCalled()
    model.setQuery("b. ")
    timers.advance(1)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith("b1", { query: "b." }, expect.any(AbortSignal))
    await settle()
    expect(model.getSnapshot()).toEqual({
      query: "b. ",
      result: {
        status: "ready",
        term: "b.",
        entries: [{ path: "a/b.ts", name: "b.ts", meta: { kind: "file" } }],
        expanded: ["a"],
        truncated: false,
      },
    })
  })

  it("clears on an empty query, aborting the search in flight", async () => {
    const timers = fakeTimers()
    const pending = deferred<BotFileSearchResult>()
    const model = createSearchModel(
      client({ search: (_s, _r, signal) => pending.run(signal) }),
      "b1",
      timers,
    )
    model.setQuery("x")
    timers.advance(SEARCH_DELAY_MS)
    model.setQuery("  ")
    expect(pending.calls[0]?.signal.aborted).toBe(true)
    expect(model.getSnapshot().result).toEqual({ status: "idle" })
    pending.calls[0]?.resolve(found("x"))
    await settle()
    expect(model.getSnapshot().result).toEqual({ status: "idle" })
    model.setQuery("y")
    model.cancel()
    expect(timers.pending()).toBe(0)
    expect(model.getSnapshot().result).toEqual({ status: "idle" })
  })

  it("collapses and expands matched directories, searches again on refresh and reports failures", async () => {
    const timers = fakeTimers()
    let failing = false
    const search = vi.fn(async () => {
      if (failing)
        throw new BotFileError({ kind: "host", code: "bot-file/search-failed", message: "rg" })
      return found("a/b.ts")
    })
    const model = createSearchModel(client({ search }), "b1", timers)
    model.setQuery("b")
    timers.advance(SEARCH_DELAY_MS)
    await settle()
    model.toggle("a", false)
    expect(model.getSnapshot().result).toMatchObject({ status: "ready", expanded: [] })
    model.toggle("a", true)
    expect(model.getSnapshot().result).toMatchObject({ status: "ready", expanded: ["a"] })
    failing = true
    model.refresh()
    timers.advance(SEARCH_DELAY_MS)
    await settle()
    expect(search).toHaveBeenCalledTimes(2)
    expect(model.getSnapshot().result).toEqual({
      status: "failed",
      term: "b",
      failure: { kind: "host", code: "bot-file/search-failed", message: "rg" },
    })
  })
})

describe("session models", () => {
  it("keeps one set per session and releases forgotten ones", async () => {
    const pending = deferred<{ path: string; entries: []; truncated: false }>()
    const models = createSessionModels(
      client({ list: (_s, _p, signal) => pending.run(signal) }),
      fakeTimers(),
    )
    const tree = models.treeOf("s1")
    expect(models.treeOf("s1")).toBe(tree)
    expect(models.searchOf("s1")).toBe(models.searchOf("s1"))
    expect(models.previewOf("s1")).toBe(models.previewOf("s1"))
    tree.load()
    models.forget((id) => id !== "s1")
    expect(pending.calls[0]?.signal.aborted).toBe(true)
    expect(models.treeOf("s1")).not.toBe(tree)
    models.dispose()
  })
})

describe("the panel width", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("reads the stored width, clamps and stores a resize", () => {
    const stored = new Map([["dsh-bots:files-width", "500"]])
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    })
    const width = createPanelWidth(FILES_PANEL_WIDTH)
    expect(width.getSnapshot()).toBe(500)
    width.resize(2000, 1000)
    expect(width.getSnapshot()).toBe(700)
    expect(stored.get("dsh-bots:files-width")).toBe("700")
  })

  it("starts from the default with a warning for an unusable stored width", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("localStorage", { getItem: () => "100", setItem: () => {} })
    expect(createPanelWidth(FILES_PANEL_WIDTH).getSnapshot()).toBe(DEFAULT_WIDTH)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
