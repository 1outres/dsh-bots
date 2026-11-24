import { request as httpRequest } from "node:http"
import type { IncusTransport } from "../host/incus"

/** HTTP over the Incus Unix socket, JSON in and out. */
export function unixSocketTransport(socketPath: string): IncusTransport {
  return (method, path, body, signal) =>
    new Promise((resolvePromise, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const req = httpRequest(
        {
          socketPath,
          path,
          method,
          signal,
          headers: {
            Host: "incus",
            ...(payload === undefined
              ? {}
              : {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on("data", (chunk: Buffer) => chunks.push(chunk))
          res.on("error", reject)
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            let parsed: unknown = text
            try {
              parsed = text === "" ? undefined : JSON.parse(text)
            } catch {
              // Keep the raw text; the client reports the status.
            }
            resolvePromise({ status: res.statusCode ?? 0, body: parsed })
          })
        },
      )
      req.on("error", (error) =>
        reject(new Error(`Incus socket ${socketPath}: ${error.message}`, { cause: error })),
      )
      req.end(payload)
    })
}
