#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { readReleaseEnv } from "./release-env.mjs"
import { versionProblems } from "./versions.mjs"
import { workspaceManifests } from "./workspace.mjs"

const tag = process.argv[2]
if (!tag) {
  console.error("usage: check-versions.mjs <tag>   (the tag being released, e.g. v0.3.0)")
  process.exit(2)
}
const root = fileURLToPath(new URL("../..", import.meta.url))
const problems = versionProblems(tag, readReleaseEnv(root), workspaceManifests(root))
for (const problem of problems) console.error(`error: ${problem}`)
if (problems.length > 0) process.exit(1)
console.log(`${tag}: infra/release.env and every package name this version.`)
