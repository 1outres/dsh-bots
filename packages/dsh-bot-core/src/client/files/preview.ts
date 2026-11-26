import type { BotFilesClient } from "../files"
import { MARKDOWN_RENDER_LIMIT } from "../markdown"

export const PAGE_LINES = 1000
export const LINE_CONTEXT = 40
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
}

const MARKDOWN = new Set(["md", "markdown", "mdown", "mkd", "mdx"])

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}

export function previewKind(path: string): "image" | "markdown" | "text" {
  const extension = extensionOf(path)
  if (IMAGE_TYPES[extension] !== undefined) return "image"
  return MARKDOWN.has(extension) ? "markdown" : "text"
}

export function imageMimeType(path: string): string | undefined {
  return IMAGE_TYPES[extensionOf(path)]
}

export function lineWindowStart(line: number | undefined): number {
  if (line === undefined || !Number.isFinite(line) || line <= 1) return 1
  return Math.max(1, Math.floor(line) - LINE_CONTEXT)
}

export function splitLines(text: string, count: number): string[] {
  return count === 0 ? [] : text.split("\n")
}

export interface PreviewRequest {
  readonly path: string
  readonly line?: number
  readonly revision: number
}

export function sameRequest(a: PreviewRequest, b: PreviewRequest): boolean {
  return a.path === b.path && a.line === b.line && a.revision === b.revision
}

export interface ImagePreview {
  readonly kind: "image"
  readonly absolutePath: string
  readonly src: string
}

export interface OversizedPreview {
  readonly kind: "oversized"
  readonly absolutePath: string
  readonly bytes: number
  readonly limit: number
}

export interface TextPreview {
  readonly kind: "text"
  readonly absolutePath: string
  readonly markdown: boolean
  readonly start: number
  readonly lines: readonly string[]
  readonly eof: boolean
  readonly line?: number
}

export type Preview = ImagePreview | OversizedPreview | TextPreview

export type ExtendDirection = "before" | "after"

export async function loadPreview(
  files: BotFilesClient,
  sessionId: string,
  request: PreviewRequest,
  signal: AbortSignal,
): Promise<Preview> {
  const { path, line } = request
  const mime = imageMimeType(path)
  if (mime !== undefined) {
    const stat = await files.stat(sessionId, path, signal)
    if (stat.bytes !== undefined && stat.bytes > MAX_IMAGE_BYTES) {
      return {
        kind: "oversized",
        absolutePath: stat.absolutePath,
        bytes: stat.bytes,
        limit: MAX_IMAGE_BYTES,
      }
    }
    const bytes = await files.readBytes(sessionId, path, {}, signal)
    return {
      kind: "image",
      absolutePath: bytes.absolutePath,
      src: `data:${mime};base64,${bytes.base64}`,
    }
  }
  const start = lineWindowStart(line)
  const page = await files.read(sessionId, path, { offset: start, limit: PAGE_LINES }, signal)
  return {
    kind: "text",
    absolutePath: page.absolutePath,
    markdown: previewKind(path) === "markdown",
    start,
    lines: splitLines(page.text, page.lines),
    eof: page.eof,
    ...(line === undefined ? {} : { line }),
  }
}

export async function extendPreview(
  files: BotFilesClient,
  sessionId: string,
  path: string,
  preview: TextPreview,
  direction: ExtendDirection,
  signal: AbortSignal,
): Promise<TextPreview> {
  if (direction === "after") {
    if (preview.eof) return preview
    const offset = preview.start + preview.lines.length
    const page = await files.read(sessionId, path, { offset, limit: PAGE_LINES }, signal)
    return {
      ...preview,
      lines: [...preview.lines, ...splitLines(page.text, page.lines)],
      eof: page.eof,
    }
  }
  if (preview.start <= 1) return preview
  const offset = Math.max(1, preview.start - PAGE_LINES)
  const limit = preview.start - offset
  const page = await files.read(sessionId, path, { offset, limit }, signal)
  return {
    ...preview,
    start: offset,
    lines: [...splitLines(page.text, page.lines), ...preview.lines],
  }
}

export function rendersMarkdown(preview: TextPreview): boolean {
  return (
    preview.markdown &&
    preview.start === 1 &&
    preview.eof &&
    preview.lines.reduce((size, line) => size + line.length + 1, 0) <= MARKDOWN_RENDER_LIMIT
  )
}
