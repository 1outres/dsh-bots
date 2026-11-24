import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { FileTreeInput } from "../src/client/dsh/sidebar-files"
import type { RenderFactory } from "../src/client/dsh/slots"
import type { BotFileFailure } from "../src/client/file-failure"
import type { BotFilesClient } from "../src/client/files"
import { BrowseView } from "../src/client/files/BrowseView"
import { FilePreview } from "../src/client/files/FilePreview"
import { FilesPanel } from "../src/client/files/FilesPanel"
import { FileTreeView, searchInput } from "../src/client/files/FileTreeView"
import { createSessionModels, type FilesFace } from "../src/client/files/files-face"
import { createPanelFocus } from "../src/client/files/panel-focus"
import type { PanelWidth } from "../src/client/files/panel-width"
import type { PreviewRequest } from "../src/client/files/preview"
import type { PreviewModel, PreviewState } from "../src/client/files/preview-model"
import type { SearchModel, SearchState } from "../src/client/files/search-model"
import { createViewer, type Viewer } from "../src/client/viewer"
import { t, value } from "./support/client"

const REQUEST: PreviewRequest = { path: "dir/a.ts", line: 2, revision: 1 }

function previewModel(state: PreviewState): PreviewModel {
  return { ...value(state), load: vi.fn(), extend: vi.fn(), cancel: vi.fn() }
}

const preview = (state: PreviewState) =>
  renderToStaticMarkup(
    createElement(FilePreview, { t, model: previewModel(state), request: REQUEST }),
  )

/** The Factory as DSH registers it: here, the input it was handed. */
function factory(): RenderFactory & { inputs: FileTreeInput[] } {
  const inputs: FileTreeInput[] = []
  const render = (name: string, props: object): ReactNode => {
    expect(name).toBe("sidebar.files.tree")
    inputs.push(props as FileTreeInput)
    return createElement("div", { "data-tree": "" })
  }
  return Object.assign(render, { inputs })
}

/** The renderer without the Factory registered: it draws the fallback. */
const missingFactory: RenderFactory = (_name, _props, options) => options.fallback

const files = {} as BotFilesClient

function face(overrides: Partial<FilesFace> & { viewer: Viewer }): FilesFace {
  const models = createSessionModels(files, { set: () => 0, clear: () => {} })
  const width: PanelWidth = { ...value(420), resize: vi.fn() }
  return {
    width,
    linksAvailable: value(true),
    treeOf: models.treeOf,
    searchOf: models.searchOf,
    previewOf: models.previewOf,
    ...overrides,
  }
}

describe("FilePreview", () => {
  it("reads as loading until the state answers the request on show", () => {
    expect(preview({ status: "idle" })).toContain("files.loading")
    expect(preview({ status: "loading", request: REQUEST })).toContain("files.loading")
    expect(
      preview({
        status: "failed",
        request: { ...REQUEST, revision: 0 },
        failure: { kind: "connection", message: "" },
      }),
    ).toContain("files.loading")
  })

  it.each<[BotFileFailure, string]>([
    [{ kind: "host", code: "bot-file/not-text", message: "" }, "files.error.not-text"],
    [{ kind: "host", code: "gateway/bad-request", message: "" }, "files.error.bad-request"],
    [{ kind: "connection", message: "" }, "files.error.connection"],
    [{ kind: "mount", message: "" }, "files.error.remote-mount-failed"],
    [
      { kind: "protocol", violation: { kind: "malformed-result" }, message: "", raw: 1 },
      "files.error.protocol",
    ],
  ])("words a %o failure", (failure, key) => {
    const html = preview({ status: "failed", request: REQUEST, failure })
    expect(html).toContain(key)
    expect(html).toContain(`data-dshb-files-failure="${failure.kind}"`)
    expect(html).toContain('role="alert"')
  })

  it("draws text with the requested line, a failed page below it, and an oversized image as a note", () => {
    const html = preview({
      status: "ready",
      request: REQUEST,
      preview: {
        kind: "text",
        absolutePath: "/w/dir/a.ts",
        markdown: false,
        start: 1,
        lines: ["one", "two"],
        eof: false,
        line: 2,
      },
      extension: {
        status: "failed",
        direction: "after",
        failure: { kind: "connection", message: "" },
      },
    })
    expect(html).toContain("/w/dir/a.ts")
    expect(html).toMatch(/data-current="">.*two/)
    expect(html).toContain("files.more")
    expect(html).toContain("files.error.connection")
    expect(
      preview({
        status: "ready",
        request: REQUEST,
        preview: { kind: "oversized", absolutePath: "/w/p.png", bytes: 9, limit: 8 },
        extension: { status: "idle" },
      }),
    ).toContain("files.error.too-large")
  })

  it("renders a whole markdown file", () => {
    const html = preview({
      status: "ready",
      request: REQUEST,
      preview: {
        kind: "text",
        absolutePath: "/a.md",
        markdown: true,
        start: 1,
        lines: ["# Hi"],
        eof: true,
      },
      extension: { status: "idle" },
    })
    expect(html).toContain("<h1>Hi</h1>")
    expect(html).toContain("files.source")
  })
})

describe("FileTreeView", () => {
  it("hands DSH's Factory the input", () => {
    const render = factory()
    const input = searchInput(
      "b",
      {
        entries: [{ path: "a", name: "a", meta: { kind: "directory" } }],
        expanded: ["a"],
        truncated: false,
      },
      { onToggle: () => {}, onOpen: () => {} },
    )
    expect(
      renderToStaticMarkup(createElement(FileTreeView, { t, renderFactory: render, input })),
    ).toBe('<div data-tree=""></div>')
    expect(render.inputs[0]).toMatchObject({
      highlight: "b",
      directories: { "": { omitted: "unmatched" }, a: { omitted: "unmatched" } },
    })
  })

  it("shows an error, never a tree of its own, without the Factory", () => {
    const html = renderToStaticMarkup(
      createElement(FileTreeView, {
        t,
        renderFactory: missingFactory,
        input: searchInput(
          "x",
          { entries: [], expanded: [], truncated: false },
          {
            onToggle: () => {},
            onOpen: () => {},
          },
        ),
      }),
    )
    expect(html).toContain("files.error.tree-unavailable")
    expect(html).toContain("data-dshb-files-tree-unavailable")
    expect(html).not.toContain("<button")
  })
})

describe("BrowseView", () => {
  const browse = (props: { face: FilesFace; renderFactory?: RenderFactory }) =>
    renderToStaticMarkup(
      createElement(BrowseView, {
        t,
        sessionId: "s1",
        face: props.face,
        renderFactory: props.renderFactory ?? factory(),
        current: "dir/a.ts",
        focus: createPanelFocus(),
      }),
    )

  it("draws the workspace tree and says when file links cannot reach the viewer", () => {
    const render = factory()
    const html = browse({
      face: face({ viewer: createViewer(), linksAvailable: value(false) }),
      renderFactory: render,
    })
    expect(html).toContain("files.linksUnavailable")
    expect(render.inputs[0]).toMatchObject({
      root: "",
      entries: [],
      expanded: [],
      current: "dir/a.ts",
    })
    expect(render.inputs[0]?.currentRef).toBeTypeOf("function")
  })

  it.each<[SearchState["result"], string]>([
    [{ status: "loading", term: "x" }, "files.search.loading"],
    [
      {
        status: "failed",
        term: "x",
        failure: { kind: "protocol", violation: { kind: "malformed-result" }, message: "", raw: 1 },
      },
      "files.error.protocol",
    ],
    [
      { status: "ready", term: "x", entries: [], expanded: [], truncated: false },
      "files.search.none",
    ],
    [
      {
        status: "ready",
        term: "x",
        entries: [{ path: "x.ts", name: "x.ts", meta: { kind: "file" } }],
        expanded: [],
        truncated: true,
      },
      "files.search.countTruncated.one(1)",
    ],
  ])("summarizes a %o search", (result, text) => {
    const search: SearchModel = {
      ...value<SearchState>({ query: "x", result }),
      setQuery: vi.fn(),
      toggle: vi.fn(),
      refresh: vi.fn(),
      cancel: vi.fn(),
    }
    const html = browse({ face: face({ viewer: createViewer(), searchOf: () => search }) })
    expect(html).toContain(text)
    expect(html).toContain('value="x"')
  })
})

describe("FilesPanel", () => {
  const panel = (viewer: Viewer) =>
    renderToStaticMarkup(
      createElement(FilesPanel, {
        t,
        sessionId: "s1",
        face: face({ viewer }),
        renderFactory: factory(),
        containerRef: { current: null },
        returnFocus: () => {},
      }),
    )

  it("draws nothing while closed", () => {
    expect(panel(createViewer())).toBe("")
  })

  it("titles the panel after its content, at the stored width", () => {
    const viewer = createViewer()
    viewer.browse("s1")
    const browsing = panel(viewer)
    expect(browsing).toContain("width:420px")
    expect(browsing).toContain("files.title")
    expect(browsing).toContain("files.refresh")
    viewer.openFile("s1", "dir/a.ts")
    const file = panel(viewer)
    expect(file).toContain(">a.ts</h2>")
    expect(file).toContain("files.back")
    expect(file).toContain("files.loading")
    viewer.showDocument("s1", "Plan", "# Steps")
    const document = panel(viewer)
    expect(document).toContain(">Plan</h2>")
    expect(document).toContain("<h1>Steps</h1>")
    expect(document).not.toContain("files.refresh")
  })
})
