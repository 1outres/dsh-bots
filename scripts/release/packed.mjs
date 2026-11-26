import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SCOPE, workspaceManifests } from "./workspace.mjs"

const PUBLISHED_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"]

function expectedRange(field, version) {
  return field === "peerDependencies" ? `^${version}` : version
}

export function packedManifestProblems(manifest, version) {
  const problems = []
  if (manifest.version !== version) {
    problems.push(`${manifest.name} packs version ${manifest.version}, not ${version}`)
  }
  for (const field of [...PUBLISHED_FIELDS, "devDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (range.startsWith("workspace:")) {
        problems.push(`${manifest.name}: ${field}.${name} is still ${range} in the tarball`)
      } else if (PUBLISHED_FIELDS.includes(field) && name.startsWith(`${SCOPE}/`)) {
        const expected = expectedRange(field, version)
        if (range !== expected) {
          problems.push(`${manifest.name}: ${field}.${name} is ${range}, not ${expected}`)
        }
      }
    }
  }
  return problems
}

export function packWorkspace(root) {
  const destination = mkdtempSync(join(tmpdir(), "dsh-bots-release-pack-"))
  try {
    const output = execFileSync(
      "pnpm",
      ["-r", "--filter", "./packages/*", "pack", "--pack-destination", destination, "--json"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    )
    const reports = JSON.parse(output)
    if (!Array.isArray(reports)) throw new Error("pnpm -r pack --json did not print a list")
    return reports.map((report) =>
      JSON.parse(
        execFileSync("tar", ["-xOzf", report.filename, "package/package.json"], {
          encoding: "utf8",
        }),
      ),
    )
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

export function packedProblems(root, version) {
  const packed = packWorkspace(root)
  const expected = workspaceManifests(root).map(({ manifest }) => manifest.name)
  const names = packed.map((manifest) => manifest.name)
  const unpacked = expected.filter((name) => !names.includes(name))
  return [
    ...unpacked.map((name) => `${name} was not packed`),
    ...packed.flatMap((manifest) => packedManifestProblems(manifest, version)),
  ]
}
