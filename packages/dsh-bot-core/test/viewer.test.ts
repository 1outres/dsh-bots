import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BotFileError } from "../src/client/file-failure"
import type { BotFilesClient } from "../src/client/files"
import { MarkdownView } from "../src/client/files/MarkdownView"
import { clampWidth, MIN_WIDTH } from "../src/client/files/panel-width"
import {
  extendPreview,
  LINE_CONTEXT,
  lineWindowStart,
  loadPreview,
  MAX_IMAGE_BYTES,
  PAGE_LINES,
  previewKind,
  rendersMarkdown,
  type TextPreview,
} from "../src/client/files/preview"
import { searchMatches } from "../src/client/files/search-model"
import { ancestorsOf } from "../src/client/files/tree-model"
import { MARKDOWN_RENDER_LIMIT, parseInline, parseMarkdown, safeHref } from "../src/client/markdown"
import { createViewer } from "../src/client/viewer"
import type { BotFileText } from "../src/shared/files"

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

const page = (offset: number, lines: string[], eof: boolean): BotFileText => ({
  absolutePath: "/home/bot/workspace/a.ts",
  version: "v",
  offset,
  text: lines.join("\n"),
  lines: lines.length,
  eof,
})

const signal = () => new AbortController().signal

describe("the viewer state", () => {
  it("opens files with a new serial each time and refreshes only a file", () => {
    const viewer = createViewer()
    viewer.openFile("s1", "a.ts", 3)
    const first = viewer.of("s1").content
    expect(first).toMatchObject({ kind: "file", path: "a.ts", line: 3 })
    viewer.refresh("s1")
    const refreshed = viewer.of("s1").content
    expect(refreshed).toMatchObject({ kind: "file", path: "a.ts", line: 3 })
    expect(
      refreshed.kind === "file" && first.kind === "file" && refreshed.serial > first.serial,
    ).toBe(true)
    viewer.browse("s1")
    const browsing = viewer.getSnapshot()
    viewer.refresh("s1")
    expect(viewer.getSnapshot()).toBe(browsing)
  })

  it("toggles, closes, notifies and forgets per session", () => {
    const viewer = createViewer()
    const listener = vi.fn()
    viewer.subscribe(listener)
    viewer.toggle("s1")
    expect(viewer.of("s1")).toEqual({ open: true, content: { kind: "browse" } })
    viewer.close("s1")
    viewer.close("s1")
    expect(viewer.of("s1").open).toBe(false)
    viewer.notify("s2", "files.refused", { name: "x" })
    expect(viewer.getSnapshot().notices.s2).toMatchObject({
      key: "files.refused",
      params: { name: "x" },
    })
    viewer.dismiss("s2")
    expect(viewer.getSnapshot().notices.s2).toBeUndefined()
    const before = listener.mock.calls.length
    viewer.forget(() => true)
    expect(listener.mock.calls.length).toBe(before)
    viewer.forget((id) => id !== "s1")
    expect(viewer.getSnapshot().sessions.s1).toBeUndefined()
  })
})

describe("previews", () => {
  it("classifies by name and starts a little above a requested line", () => {
    expect(previewKind("a/b.PNG")).toBe("image")
    expect(previewKind("README.md")).toBe("markdown")
    expect(previewKind(".env")).toBe("text")
    expect(previewKind("Makefile")).toBe("text")
    expect(lineWindowStart(undefined)).toBe(1)
    expect(lineWindowStart(10)).toBe(1)
    expect(lineWindowStart(400)).toBe(400 - LINE_CONTEXT)
  })

  it("loads text from the line window and pages before and after it", async () => {
    const read = vi.fn(
      async (_s: string, _p: string, range?: { offset?: number; limit?: number }) => {
        const offset = range?.offset ?? 1
        const limit = range?.limit ?? PAGE_LINES
        const lines = Array.from({ length: limit }, (_, i) => `line ${offset + i}`)
        return page(offset, lines, offset + limit > 3000)
      },
    )
    const files = client({ read })
    const aborts = signal()
    const preview = await loadPreview(
      files,
      "b1",
      { path: "a.ts", line: 1500, revision: 1 },
      aborts,
    )
    expect(preview).toMatchObject({
      kind: "text",
      start: 1460,
      line: 1500,
      markdown: false,
      eof: false,
    })
    expect(read).toHaveBeenCalledWith("b1", "a.ts", { offset: 1460, limit: PAGE_LINES }, aborts)
    if (preview.kind !== "text") throw new Error("text expected")
    const before = await extendPreview(files, "b1", "a.ts", preview, "before", signal())
    expect(before.start).toBe(460)
    expect(before.lines[0]).toBe("line 460")
    expect(before.lines).toHaveLength(2000)
    const after = await extendPreview(files, "b1", "a.ts", before, "after", signal())
    expect(after.lines.at(-1)).toBe(`line ${460 + 3000 - 1}`)
    expect(after.eof).toBe(true)
  })

  it("previews an image as a data URL and refuses an oversized one before reading it", async () => {
    const readBytes = vi.fn(async () => ({
      absolutePath: "/w/p.png",
      version: "v",
      offset: 0,
      base64: "AAAA",
      eof: true,
    }))
    const small = client({
      stat: async () => ({ absolutePath: "/w/p.png", version: "v", bytes: 3 }),
      readBytes,
    })
    await expect(
      loadPreview(small, "b1", { path: "p.png", revision: 1 }, signal()),
    ).resolves.toEqual({
      kind: "image",
      absolutePath: "/w/p.png",
      src: "data:image/png;base64,AAAA",
    })
    const unsized = client({
      stat: async () => ({ absolutePath: "/w/p.png", version: "v" }),
      readBytes,
    })
    await expect(
      loadPreview(unsized, "b1", { path: "p.png", revision: 1 }, signal()),
    ).resolves.toMatchObject({ kind: "image" })
    const big = client({
      stat: async () => ({ absolutePath: "/w/p.png", version: "v", bytes: MAX_IMAGE_BYTES + 1 }),
      readBytes,
    })
    await expect(loadPreview(big, "b1", { path: "p.png", revision: 1 }, signal())).resolves.toEqual(
      {
        kind: "oversized",
        absolutePath: "/w/p.png",
        bytes: MAX_IMAGE_BYTES + 1,
        limit: MAX_IMAGE_BYTES,
      },
    )
    expect(readBytes).toHaveBeenCalledTimes(2)
  })

  it("passes the client's failure through", async () => {
    const failure = new BotFileError({ kind: "host", code: "bot-file/not-text", message: "x" })
    const binary = client({ read: () => Promise.reject(failure) })
    await expect(loadPreview(binary, "b1", { path: "a.bin", revision: 1 }, signal())).rejects.toBe(
      failure,
    )
  })

  it("renders markdown only for a whole file under the cap", () => {
    const text = (overrides: Partial<TextPreview>): TextPreview => ({
      kind: "text",
      absolutePath: "/a.md",
      markdown: true,
      start: 1,
      lines: ["# a"],
      eof: true,
      ...overrides,
    })
    expect(rendersMarkdown(text({}))).toBe(true)
    expect(rendersMarkdown(text({ markdown: false }))).toBe(false)
    expect(rendersMarkdown(text({ start: 2 }))).toBe(false)
    expect(rendersMarkdown(text({ eof: false }))).toBe(false)
    expect(rendersMarkdown(text({ lines: ["x".repeat(MARKDOWN_RENDER_LIMIT)] }))).toBe(false)
  })
})

describe("tree rows", () => {
  it("draws search matches as an expanded tree", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"])
    expect(
      searchMatches({
        matches: [
          { path: "a", type: "directory" },
          { path: "a/b/c.ts", type: "file" },
        ],
        truncated: false,
        incomplete: true,
      }),
    ).toEqual({
      entries: [
        { path: "a", name: "a", meta: { kind: "directory" } },
        { path: "a/b/c.ts", name: "c.ts", meta: { kind: "file" } },
      ],
      expanded: ["a", "a/b"],
      truncated: true,
    })
  })

  it("keeps the panel width between the minimum and 70% of the shell", () => {
    expect(clampWidth(100, 1000)).toBe(MIN_WIDTH)
    expect(clampWidth(900, 1000)).toBe(700)
    expect(clampWidth(450.4, 1000)).toBe(450)
  })
})

describe("markdown", () => {
  it("reads blocks", () => {
    expect(
      parseMarkdown(
        "# Title\n\nSome *text*\nwrapped.\n\n- a\n- b\n  more\n\n```ts\nconst x = 1\n```\n> quote\n\n---\n1. one",
      ),
    ).toEqual([
      { kind: "heading", level: 1, content: [{ kind: "text", text: "Title" }] },
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Some " },
          { kind: "em", children: [{ kind: "text", text: "text" }] },
          { kind: "text", text: " wrapped." },
        ],
      },
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b more" }]],
      },
      { kind: "code", language: "ts", text: "const x = 1" },
      {
        kind: "quote",
        blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "quote" }] }],
      },
      { kind: "rule" },
      { kind: "list", ordered: true, items: [[{ kind: "text", text: "one" }]] },
    ])
  })

  it("keeps links to http(s) and mailto only, and never emits raw HTML", () => {
    expect(safeHref("https://x.y/")).toBe("https://x.y/")
    expect(safeHref("javascript:alert(1)")).toBeUndefined()
    expect(parseInline("[ok](https://a.b) [bad](javascript:x) `code` **b**")).toEqual([
      { kind: "link", href: "https://a.b", children: [{ kind: "text", text: "ok" }] },
      { kind: "text", text: " " },
      { kind: "link", children: [{ kind: "text", text: "bad" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "code" },
      { kind: "text", text: " " },
      { kind: "strong", children: [{ kind: "text", text: "b" }] },
    ])
    const html = renderToStaticMarkup(
      createElement(MarkdownView, {
        source: "<img src=x onerror=alert(1)> [x](javascript:y) [y](https://e.f)",
      }),
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('<a href="https://e.f" target="_blank" rel="noopener noreferrer">y</a>')
  })

  it("parses pathological input in linear time", () => {
    const size = 256 * 1024
    const inputs = [
      "*a ".repeat(size / 3),
      "**".repeat(size / 2),
      "_a".repeat(size / 2),
      "[".repeat(size),
      "[a](".repeat(size / 4),
      "`a".repeat(size / 2),
      "`".repeat(size),
      `# ${" ".repeat(size)}x`,
      "- ".repeat(size / 2),
      `${"> ".repeat(size / 2)}x`,
    ]
    for (const input of inputs) {
      const started = performance.now()
      parseMarkdown(input)
      expect(performance.now() - started, input.slice(0, 12)).toBeLessThan(1500)
    }
    expect(MARKDOWN_RENDER_LIMIT).toBe(256 * 1024)
  })

  it("keeps unmatched delimiters as text and closes headings", () => {
    expect(parseInline("a * b `c [d] (e) _f")).toEqual([
      { kind: "text", text: "a * b `c [d] (e) _f" },
    ])
    expect(parseInline("snake_case_name")).toEqual([{ kind: "text", text: "snake_case_name" }])
    expect(
      parseInline("See https://github.com/o/r/compare/v1...v2. Or ftp://x, xhttps://y"),
    ).toEqual([
      { kind: "text", text: "See " },
      {
        kind: "link",
        href: "https://github.com/o/r/compare/v1...v2",
        children: [{ kind: "text", text: "https://github.com/o/r/compare/v1...v2" }],
      },
      { kind: "text", text: ". Or ftp://x, xhttps://y" },
    ])
    expect(parseInline("[https://a.b](https://a.b)")).toEqual([
      { kind: "link", href: "https://a.b", children: [{ kind: "text", text: "https://a.b" }] },
    ])
    expect(parseInline("`` a`b ``")).toEqual([{ kind: "code", text: "a`b" }])
    expect(parseMarkdown("## Title ##")).toEqual([
      { kind: "heading", level: 2, content: [{ kind: "text", text: "Title" }] },
    ])
    expect(parseMarkdown("#hashtag")[0]?.kind).toBe("paragraph")
  })
})
