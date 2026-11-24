// node:crypto is allowed here (digests); DSH packages, node:fs and timers are not.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs" // rule: 14
import type { Context } from "@deepseek-ai/cordis" // rule: 12

export type Unused = Context
export const digest = () => createHash("sha256").update(readFileSync("x")).digest("hex")
setTimeout(() => {}, 0) // rule: 26
