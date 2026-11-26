import type { IncomingMessage, ServerResponse } from "node:http"
import type { SpaceHttpRequest, SpaceHttpResponse } from "./http"
import type { LiveSink } from "./live"

const readBody = (request: IncomingMessage, maxBytes: number): Promise<Uint8Array | undefined> =>
  new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let over = false
    request.on("data", (chunk: Uint8Array) => {
      if (over) return
      size += chunk.length
      if (size > maxBytes) {
        over = true
        resolve(undefined)
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      if (over) return
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      resolve(bytes)
    })
    request.on("error", reject)
  })

export function spaceRequestOf(request: IncomingMessage, signal: AbortSignal): SpaceHttpRequest {
  const url = new URL(request.url ?? "/", "http://space.invalid")
  return {
    method: request.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    header(name) {
      const value = request.headers[name.toLowerCase()]
      return Array.isArray(value) ? value[0] : value
    },
    body: (maxBytes) => readBody(request, maxBytes),
    signal,
  }
}

function sseSink(response: ServerResponse): LiveSink {
  return {
    send(event, data) {
      if (!response.writableEnded)
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    comment() {
      if (!response.writableEnded) response.write(": keep-alive\n\n")
    },
    close() {
      if (!response.writableEnded) response.end()
    },
  }
}

export async function writeSpaceResponse(
  request: IncomingMessage,
  response: ServerResponse,
  result: SpaceHttpResponse,
): Promise<void> {
  if (result.kind === "stream") {
    response.writeHead(200, { ...result.headers })
    response.flushHeaders()
    response.write(": open\n\n")
    const detach = result.attach(sseSink(response))
    if (detach === undefined) {
      response.end()
      return
    }
    const done = () => detach()
    request.on("close", done)
    response.on("close", done)
    return
  }
  response.writeHead(result.status, { ...result.headers })
  if (result.body === null) {
    response.end()
    return
  }
  if (result.body instanceof Uint8Array) {
    response.end(result.body)
    return
  }
  const reader = result.body.getReader()
  const stop = () => void reader.cancel().catch(() => {})
  response.on("close", stop)
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (!response.write(next.value)) {
        await new Promise<void>((resolve) => response.once("drain", () => resolve()))
      }
    }
    response.end()
  } catch {
    response.destroy()
  } finally {
    response.off("close", stop)
  }
}
