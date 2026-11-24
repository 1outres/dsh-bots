import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export function fileJournal(dir) {
  mkdirSync(dir, { recursive: true })
  return (entry) =>
    appendFileSync(
      join(dir, "results.log"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    )
}

export const discard = () => {}
