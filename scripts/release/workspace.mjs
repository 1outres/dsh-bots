import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const SCOPE = "@1outres"

export function workspaceManifests(root) {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = `packages/${name}/package.json`
      return { path, manifest: JSON.parse(readFileSync(join(root, path), "utf8")) }
    })
}
