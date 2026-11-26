#!/usr/bin/env node
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, rmSync } from "node:fs"
import { connect, createServer } from "node:net"

const args = process.argv.slice(2)
appendFileSync(process.env.SSH_STUB_LOG, `${JSON.stringify(args)}\n`)
const value = (flag) => {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}
const configFile = value("-F")
if (configFile === undefined || !existsSync(configFile)) {
  process.stderr.write("stub: no -F config\n")
  process.exit(255)
}
const control = value("-S")
const operation = value("-O")
if (operation !== undefined) {
  const socket = connect(control)
  socket.on("error", () => process.exit(255))
  socket.end(`${JSON.stringify({ operation, forward: value("-L") })}\n`)
  socket.on("data", (data) => process.exit(data.toString().startsWith("ok") ? 0 : 255))
} else {
  const forwards = new Map()
  const server = createServer((client) => {
    let line = ""
    client.on("data", (chunk) => {
      line += chunk
      if (!line.includes("\n")) return
      const request = JSON.parse(line)
      const [local, remote] = request.forward.split(":")
      if (request.operation === "forward") {
        const forward = createServer({ allowHalfOpen: true }, (socket) => {
          const target = connect({ path: remote, allowHalfOpen: true })
          socket.pipe(target).pipe(socket)
          target.on("error", () => socket.destroy())
          socket.on("error", () => target.destroy())
        })
        forward.listen(local, () => client.end("ok\n"))
        forwards.set(request.forward, forward)
      } else {
        forwards.get(request.forward)?.close()
        forwards.delete(request.forward)
        rmSync(local, { force: true })
        client.end("ok\n")
      }
    })
  })
  server.listen(control)
  const child = spawn("sh", ["-c", args.at(-1)], { stdio: ["pipe", "pipe", "inherit"] })
  process.stdin.pipe(child.stdin)
  child.stdout.pipe(process.stdout)
  child.on("exit", (code) => {
    server.close()
    for (const forward of forwards.values()) forward.close()
    process.exit(code ?? 255)
  })
}
