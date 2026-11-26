import { createHash } from "node:crypto"
import { createReadStream, readFileSync, statSync } from "node:fs"
import { call, endpointFrom, waitOp } from "./incus.mjs"

const [endpointFile, project, file, alias] = process.argv.slice(2)
const ep = endpointFrom({ ...JSON.parse(readFileSync(endpointFile, "utf8")), project })
let t = Date.now()
const hash = createHash("sha256")
for await (const c of createReadStream(file)) hash.update(c)
const fp = hash.digest("hex")
console.log("sha256", fp, `${Date.now() - t}ms`)
t = Date.now()
const env = await call(ep, "POST", "/1.0/images", createReadStream(file), {
  "Content-Type": "application/octet-stream",
  "Content-Length": statSync(file).size,
  "X-Incus-public": "false",
})
const md = await waitOp(ep, env)
console.log("upload+import", `${Date.now() - t}ms`, JSON.stringify(md.metadata))
await call(ep, "POST", "/1.0/images/aliases", { name: alias, target: fp, description: "spike" })
const img = await call(ep, "GET", `/1.0/images/${fp}`)
console.log("alias ok", img.metadata.fingerprint === fp, img.metadata.properties?.["dsh.version"])
