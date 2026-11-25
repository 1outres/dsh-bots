import { spawn } from "node:child_process"

declare const stderr: Buffer

export const run = () => spawn("op", ["whoami"], { env: {}, shell: false })
export const reasonText = () => stderr.toString("utf8")
