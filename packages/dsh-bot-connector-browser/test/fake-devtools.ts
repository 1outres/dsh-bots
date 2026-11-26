import { createHash } from "node:crypto"
import { createServer, type Server } from "node:http"
import type { Socket } from "node:net"

export interface FakeElement {
  readonly tag: string
  readonly type: string | null
  readonly editable: boolean
  readonly disabled: boolean
  readonly password: boolean
}

export interface FakeFrame {
  readonly id: string
  origin: string
  marks: number
  readonly children?: readonly FakeFrame[]
}

export interface FakeTab {
  readonly targetId: string
  readonly type: "page" | "iframe"
  readonly main: FakeFrame
}

export interface DevtoolsLog {
  readonly method: string
  readonly sessionId?: string
  readonly params: Record<string, unknown>
  readonly raw: Buffer
}

export interface FakeDevtoolsModel {
  readonly tabs: FakeTab[]
  element: FakeElement
  onFrameTree?: (count: number) => void
}

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

function frameTree(frame: FakeFrame, parentId?: string): object {
  return {
    frame: {
      id: frame.id,
      securityOrigin: frame.origin,
      ...(parentId === undefined ? {} : { parentId }),
    },
    childFrames: (frame.children ?? []).map((child) => frameTree(child, frame.id)),
  }
}

function allFrames(frame: FakeFrame): FakeFrame[] {
  return [frame, ...(frame.children ?? []).flatMap(allFrames)]
}

function encodeFrame(text: string): Buffer {
  const payload = Buffer.from(text)
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : payload.length < 0x10000
        ? Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
        : (() => {
            const h = Buffer.alloc(10)
            h[0] = 0x81
            h[1] = 127
            h.writeBigUInt64BE(BigInt(payload.length), 2)
            return h
          })()
  return Buffer.concat([header, payload])
}

export async function startFakeDevtools(model: FakeDevtoolsModel) {
  const log: DevtoolsLog[] = []
  const sockets = new Set<Socket>()
  let frameTreeCalls = 0
  let send: ((message: object) => void) | undefined
  const contexts = new Map<number, { frame: FakeFrame }>()
  let nextContext = 1

  const handle = (message: DevtoolsLog & { id: number }) => {
    const { method, params, sessionId } = message
    const tab = model.tabs.find((candidate) => `s-${candidate.targetId}` === sessionId)
    switch (method) {
      case "Target.getTargets":
        return {
          targetInfos: [
            { targetId: "sw", type: "service_worker", url: "chrome-extension://x/sw.js" },
            ...model.tabs.map((entry) => ({
              targetId: entry.targetId,
              type: entry.type,
              url: entry.main.origin,
            })),
          ],
        }
      case "Target.attachToTarget":
        return { sessionId: `s-${String(params.targetId)}` }
      case "Page.getFrameTree":
        frameTreeCalls += 1
        model.onFrameTree?.(frameTreeCalls)
        if (tab === undefined) throw new Error("no session")
        return { frameTree: frameTree(tab.main) }
      case "Page.createIsolatedWorld": {
        const frame =
          tab === undefined ? undefined : allFrames(tab.main).find((f) => f.id === params.frameId)
        if (frame === undefined) throw new Error("No frame for given id found")
        const id = nextContext++
        contexts.set(id, { frame })
        return { executionContextId: id }
      }
      case "Runtime.evaluate": {
        const context = contexts.get(Number(params.contextId))
        if (context === undefined) throw new Error("no context")
        const marks = context.frame.marks
        return marks === 1
          ? { result: { type: "object", objectId: `el-${context.frame.id}` } }
          : { result: { type: "number", value: marks } }
      }
      case "Runtime.callFunctionOn": {
        const declaration = String(params.functionDeclaration)
        if (declaration.includes("removeAttribute")) {
          for (const entry of model.tabs) for (const frame of allFrames(entry.main)) frame.marks = 0
          return { result: { type: "boolean", value: true } }
        }
        if (declaration.includes("autocomplete"))
          return { result: { type: "object", value: model.element } }
        return { result: { type: "boolean", value: true } }
      }
      case "WebAuthn.addVirtualAuthenticator":
        return { authenticatorId: "auth-1" }
      default:
        return {}
    }
  }

  const server: Server = createServer((request, response) => {
    if (request.url !== "/json/version") {
      response.statusCode = 404
      response.end()
      return
    }
    const address = server.address()
    const port = typeof address === "object" && address !== null ? address.port : 0
    response.setHeader("content-type", "application/json")
    response.end(
      JSON.stringify({
        Browser: "Chrome/158.0",
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-1`,
      }),
    )
  })
  server.on("upgrade", (request, socket: Socket) => {
    sockets.add(socket)
    const key = String(request.headers["sec-websocket-key"])
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64")
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )
    const reply = (message: object) => socket.write(encodeFrame(JSON.stringify(message)))
    send = reply
    let buffer = Buffer.alloc(0)
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        if (buffer.length < 2) return
        let length = (buffer[1] as number) & 0x7f
        let offset = 2
        if (length === 126) {
          length = buffer.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          length = Number(buffer.readBigUInt64BE(2))
          offset = 10
        }
        if (buffer.length < offset + 4 + length) return
        const mask = buffer.subarray(offset, offset + 4)
        const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length))
        for (let i = 0; i < payload.length; i++)
          payload[i] = (payload[i] as number) ^ (mask[i & 3] as number)
        const opcode = (buffer[0] as number) & 0x0f
        buffer = buffer.subarray(offset + 4 + length)
        if (opcode === 0x8) {
          socket.end()
          return
        }
        if (opcode !== 0x1) continue
        const message = JSON.parse(payload.toString("utf8"))
        log.push({
          method: message.method,
          sessionId: message.sessionId,
          params: message.params ?? {},
          raw: payload,
        })
        try {
          const result = handle({ ...message, params: message.params ?? {}, raw: payload })
          reply({
            id: message.id,
            ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
            result,
          })
        } catch (error) {
          reply({ id: message.id, error: { code: -32000, message: (error as Error).message } })
        }
      }
    })
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  return {
    endpoint: `127.0.0.1:${port}`,
    log,
    emit: (message: object) => send?.(message),
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
