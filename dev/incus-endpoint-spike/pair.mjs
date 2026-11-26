import { writeFileSync } from "node:fs"
import { call, endpointFrom } from "./incus.mjs"

const [token, cert, key, out] = process.argv.slice(2)
const t = JSON.parse(Buffer.from(token, "base64").toString("utf8"))
const ep = endpointFrom({
  kind: "remote",
  url: `https://${t.addresses[0]}`,
  cert,
  key,
  serverFingerprint: t.fingerprint,
})
const before = await call(ep, "GET", "/1.0")
console.log("before:", before.metadata.auth, before.metadata.auth_methods)
const res = await call(ep, "POST", "/1.0/certificates", {
  type: "client",
  trust_token: process.env.FULL ? token : t.secret,
  name: "",
})
console.log("POST certificates:", res.status_code ?? res.status)
const after = await call(ep, "GET", "/1.0")
console.log(
  "after:",
  after.metadata.auth,
  "projects:",
  after.metadata.auth_user_name,
  after.metadata.config === undefined
    ? "(no server config visible)"
    : Object.keys(after.metadata.config),
)
writeFileSync(
  out,
  JSON.stringify(
    {
      kind: "remote",
      url: `https://${t.addresses[0]}`,
      cert,
      key,
      serverFingerprint: t.fingerprint,
    },
    null,
    2,
  ),
)
