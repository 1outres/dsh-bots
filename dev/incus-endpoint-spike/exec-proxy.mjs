import { readFileSync } from "node:fs"
import { call, endpointFrom, websocket } from "./incus.mjs"

const [endpointFile, project, instance, ...command] = process.argv.slice(2)
const ep = endpointFrom({ ...JSON.parse(readFileSync(endpointFile, "utf8")), project })
const fail = (e) => {
  process.stderr.write(`exec-proxy: ${e?.message ?? e}\n`)
  process.exit(255)
}

try {
  const env = await call(ep, "POST", `/1.0/instances/${encodeURIComponent(instance)}/exec`, {
    command,
    environment: {},
    "wait-for-websocket": true,
    interactive: false,
    "record-output": false,
    user: 0,
    group: 0,
  })
  const op = env.operation
  const fds = env.metadata.metadata.fds
  const ws = async (fd) => websocket(ep, `${op}/websocket?secret=${fds[fd]}`)
  const [control, stdin, stdout, stderr] = await Promise.all([
    ws("control"),
    ws("0"),
    ws("1"),
    ws("2"),
  ])
  control.onmessage = () => {}

  process.stdin.on("data", (d) => {
    if (!stdin.send(d)) {
      process.stdin.pause()
      stdin.socket.once("drain", () => process.stdin.resume())
    }
  })
  process.stdin.on("end", () => stdin.close())
  stdout.onmessage = (d) => {
    if (!process.stdout.write(d)) {
      stdout.socket.pause()
      process.stdout.once("drain", () => stdout.socket.resume())
    }
  }
  stderr.onmessage = (d) => process.stderr.write(d)
  let _outClosed = false
  stdout.onclose = async () => {
    _outClosed = true
    try {
      const done = await call(ep, "GET", `${op}/wait?timeout=30`)
      process.stdout.end(() => process.exit(done.metadata.metadata?.return ?? 0))
    } catch (_e) {
      process.stdout.end(() => process.exit(0))
    }
  }
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP"])
    process.on(s, () => {
      control.socket.destroy()
      stdin.socket.destroy()
      process.exit(255)
    })
} catch (e) {
  fail(e)
}
