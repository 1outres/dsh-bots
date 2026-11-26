import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

export const values = [randomUUID, homedir, join]
