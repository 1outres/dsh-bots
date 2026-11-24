import { spawn } from "node:child_process" // rule: 35
import { readFile } from "node:fs/promises" // rule: 35

export const values: unknown[] = [spawn, readFile]
