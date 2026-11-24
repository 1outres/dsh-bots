import { execFileSync } from "node:child_process"
import { basename, join, matchesGlob } from "node:path"
import type { PackageManifest } from "./packages"

/** The paths `pnpm publish` would put into the package's tarball, as `pnpm pack` lists them. */
export function packedPaths(directory: string): string[] {
  const output = execFileSync("pnpm", ["pack", "--dry-run", "--json"], {
    cwd: directory,
    encoding: "utf8",
  })
  const report = JSON.parse(output) as { files: { path: string }[] }
  return report.files.map((file) => file.path).sort()
}

/** Packs the package into `destination` and extracts it there; returns the extracted package's directory. */
export function unpack(directory: string, destination: string): string {
  const output = execFileSync("pnpm", ["pack", "--json", "--pack-destination", destination], {
    cwd: directory,
    encoding: "utf8",
  })
  const report = JSON.parse(output) as { filename: string }
  execFileSync("tar", ["-xzf", join(destination, basename(report.filename)), "-C", destination])
  return join(destination, "package")
}

/** Files git tracks in the package, relative to it. */
export function trackedPaths(directory: string): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", "."], {
    cwd: directory,
    encoding: "utf8",
  })
  return output.split("\0").filter(Boolean).sort()
}

function namedBy(path: string, entry: string): boolean {
  return path === entry || path.startsWith(`${entry}/`) || matchesGlob(path, entry)
}

/** Tracked files the manifest's `files` names that the tarball lacks. */
export function unpackedPaths(directory: string, manifest: PackageManifest): string[] {
  const packed = new Set(packedPaths(directory))
  const entries = manifest.files ?? []
  return trackedPaths(directory).filter(
    (path) => entries.some((entry) => namedBy(path, entry)) && !packed.has(path),
  )
}
