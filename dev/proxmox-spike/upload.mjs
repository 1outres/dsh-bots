import { randomBytes } from "node:crypto"
import { createReadStream, statSync } from "node:fs"
import { basename } from "node:path"
import { PassThrough } from "node:stream"
import { endpointFrom, request, waitTask } from "./pve.mjs"

const [file, content, name = basename(file)] = process.argv.slice(2)
const ep = endpointFrom()
const boundary = `----dsh${randomBytes(12).toString("hex")}`
const head = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${content}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
)
const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
const size = statSync(file).size
const body = new PassThrough()
body.write(head)
createReadStream(file)
  .on("end", () => body.end(tail))
  .pipe(body, { end: false })
const t0 = Date.now()
const r = await request(ep, "POST", `/nodes/${ep.node}/storage/${ep.storage}/upload`, body, {
  "Content-Type": `multipart/form-data; boundary=${boundary}`,
  "Content-Length": head.length + size + tail.length,
})
const t1 = Date.now()
console.log(
  "upload",
  r.status,
  r.message,
  JSON.stringify(r.body),
  `${t1 - t0} ms`,
  `${(size / 1048576 / ((t1 - t0) / 1000)).toFixed(1)} MiB/s`,
)
if (r.status === 200) {
  await waitTask(ep, ep.node, r.body.data)
  console.log("task done", `${Date.now() - t0} ms total`)
}
