import { endpointFrom, request } from "./pve.mjs"

const ep = endpointFrom()
const paths = process.argv.slice(2)
for (const p of paths) {
  const [method, path] = p.includes(" ") ? p.split(" ") : ["GET", p]
  const r = await request(ep, method, path)
  console.log(
    method,
    path,
    r.status,
    r.message,
    JSON.stringify(r.body?.data ?? r.body).slice(0, 600),
  )
}
