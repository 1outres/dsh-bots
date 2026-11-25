import { execFile, spawn } from "node:child_process"
import { writeFile } from "node:fs/promises"
import * as fs from "node:fs"

declare const bytes: Uint8Array
declare const buffer: Buffer
declare const pattern: RegExp

export function misuse() {
  spawn("op", ["whoami"]) // rule: 68
  execFile("op", ["read"]) // rule: 68
  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN // rule: 69
  new TextDecoder().decode(bytes) // rule: 70
  buffer.toString("utf8") // rule: 70
  bytes.toString() // rule: 70
  String.fromCharCode(...bytes) // rule: 70
  void writeFile("/tmp/value", bytes) // rule: 71
  fs.writeFileSync("/tmp/value", bytes) // rule: 71
  fs.createWriteStream("/tmp/value") // rule: 71
  pattern.exec("op")
  return [token, String(bytes.length), bytes.slice()]
}
