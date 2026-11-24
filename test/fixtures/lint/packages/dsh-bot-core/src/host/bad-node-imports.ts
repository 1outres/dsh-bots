import { randomUUID } from "node:crypto" // rule: 14
import { homedir } from "node:os" // rule: 14
import { join } from "node:path"

export const values = [randomUUID, homedir, join]
