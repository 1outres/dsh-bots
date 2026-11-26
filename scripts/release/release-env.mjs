import { readFileSync } from "node:fs"
import { join } from "node:path"

export const RELEASE_ENV_PATH = "infra/release.env"
export const RELEASE_ENV_KEYS = [
  "DSH_BOTS_VERSION",
  "DSH_VERSION",
  "IMAGE_TAG",
  "IMAGE_MANIFEST_SHA256",
]

const LINE = /^([A-Z0-9_]+)=([A-Za-z0-9._-]*)$/

export function parseReleaseEnv(text) {
  const env = {}
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue
    const match = LINE.exec(line)
    if (!match) {
      throw new Error(
        `${RELEASE_ENV_PATH} line ${index + 1} is not KEY=value with a plain value: ${line}`,
      )
    }
    env[match[1]] = match[2]
  }
  const missing = RELEASE_ENV_KEYS.filter((key) => !(key in env))
  if (missing.length > 0) throw new Error(`${RELEASE_ENV_PATH} lacks ${missing.join(", ")}`)
  return env
}

export function readReleaseEnv(root) {
  return parseReleaseEnv(readFileSync(join(root, RELEASE_ENV_PATH), "utf8"))
}
