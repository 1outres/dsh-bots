export const SPACES_DIRECTORY = "spaces"

export const SPACE_ENTRY = "index.html"

export const RESERVED_SEGMENT = "_dsh"

const SEGMENT = /^[A-Za-z0-9._-]+$/

const TEXT = "; charset=utf-8"

export const SPACE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: `text/html${TEXT}`,
  css: `text/css${TEXT}`,
  js: `text/javascript${TEXT}`,
  mjs: `text/javascript${TEXT}`,
  json: `application/json${TEXT}`,
  txt: `text/plain${TEXT}`,
  csv: `text/csv${TEXT}`,
  map: `application/json${TEXT}`,
  svg: `image/svg+xml${TEXT}`,
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  wasm: "application/wasm",
}

export const spaceDirectoryOf = (slug: string) => `${SPACES_DIRECTORY}/${slug}`

export type SpacePathProblem = "segment" | "hidden" | "reserved" | "type"

export function segmentProblem(segment: string, first: boolean): SpacePathProblem | undefined {
  if (segment.startsWith(".")) return "hidden"
  if (!SEGMENT.test(segment)) return "segment"
  if (first && segment === RESERVED_SEGMENT) return "reserved"
  return undefined
}

export function contentTypeOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  if (dot <= 0) return undefined
  return SPACE_CONTENT_TYPES[name.slice(dot + 1).toLowerCase()]
}

export function spacePathProblem(path: string): SpacePathProblem | undefined {
  const segments = path.split("/")
  for (const [index, segment] of segments.entries()) {
    const problem = segmentProblem(segment, index === 0)
    if (problem !== undefined) return problem
  }
  return contentTypeOf(path) === undefined ? "type" : undefined
}

export function requestedPath(raw: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  if (decoded === "" || decoded.endsWith("/")) decoded = `${decoded}${SPACE_ENTRY}`
  return spacePathProblem(decoded) === undefined ? decoded : undefined
}

export const isDocumentPath = (path: string) =>
  contentTypeOf(path)?.startsWith("text/html") === true
