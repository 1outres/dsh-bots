import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"

export const values: unknown[] = [spawn, readFile]
