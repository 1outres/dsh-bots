import { execFile, spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import * as fs from "node:fs"

declare const bytes: Uint8Array
declare const buffer: Buffer
declare const pattern: RegExp

export function misuse() {
  spawn("op", ["whoami"])
  execFile("op", ["read"])
  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN
  new TextDecoder().decode(bytes)
  buffer.toString("utf8")
  bytes.toString()
  String.fromCharCode(...bytes)
  void writeFile("/tmp/value", bytes)
  fs.writeFileSync("/tmp/value", bytes)
  fs.createWriteStream("/tmp/value")
  pattern.exec("op")
  return [token, String(bytes.length), bytes.slice()]
}
