import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import type { Context } from "@deepseek-ai/cordis"

export type Unused = Context
export const digest = () => createHash("sha256").update(readFileSync("x")).digest("hex")
setTimeout(() => {}, 0)
