#!/usr/bin/env node
import { appendFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { publishReport, registryStates } from "./registry.mjs"
import { workspaceManifests } from "./workspace.mjs"

const REGISTRY = "https://registry.npmjs.org"
const root = fileURLToPath(new URL("../..", import.meta.url))

async function fetchPackument(name) {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`${REGISTRY} answered ${response.status} for ${name}`)
  return response.json()
}

const report = publishReport(await registryStates(workspaceManifests(root), fetchPackument))
const text = ["### npm after the publish", ...report.lines, "", ...report.advice].join("\n")
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`)
