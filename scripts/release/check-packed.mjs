#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { packedProblems } from "./packed.mjs"
import { readReleaseEnv } from "./release-env.mjs"

const root = fileURLToPath(new URL("../..", import.meta.url))
const version = readReleaseEnv(root).DSH_BOTS_VERSION
const problems = packedProblems(root, version)
for (const problem of problems) console.error(`error: ${problem}`)
if (problems.length > 0) {
  console.error("fix: give workspace dependencies workspace:* and peers workspace:^<version>.")
  process.exit(1)
}
console.log(
  `Every tarball names ${version} for its @1outres dependencies, with no workspace: range left.`,
)
