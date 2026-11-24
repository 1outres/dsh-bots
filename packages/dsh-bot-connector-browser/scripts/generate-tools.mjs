#!/usr/bin/env node
/**
 * Regenerates src/generated/playwright-mcp.json: the tools of the pinned
 * Playwright MCP (vm/mcp/package.json) as its tools/list answers them with
 * TOOL_ARGUMENTS, and vm/mcp/npm-shrinkwrap.json, the tree the bot's VM
 * installs (a shrinkwrap, because pnpm pack leaves out package-lock.json).
 * The connector's tools are made from that file, and its preparation
 * refuses a VM whose server answers differently.
 *
 * Usage (after changing the version in vm/mcp/package.json and the
 * devDependency): pnpm --filter @1outres/dsh-bot-connector-browser generate
 */
import { execFileSync, spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** The server's options that shape its tools: coordinate mouse and PDF tools, no page-made tools. */
const TOOL_ARGUMENTS = ["--caps", "vision,pdf", "--no-webmcp"]
const PACKAGE = "@playwright/mcp"

const root = fileURLToPath(new URL("..", import.meta.url))
const vmPackage = JSON.parse(readFileSync(`${root}vm/mcp/package.json`, "utf8"))
const version = vmPackage.dependencies[PACKAGE]
const require = createRequire(`${root}package.json`)
const packageJson = require.resolve(`${PACKAGE}/package.json`)
const installed = JSON.parse(readFileSync(packageJson, "utf8"))
if (installed.version !== version) {
  throw new Error(`${PACKAGE} ${installed.version} is installed here, but vm/mcp pins ${version}`)
}

const npm = (args) => execFileSync("npm", args, { cwd: `${root}vm/mcp`, stdio: "inherit" })
npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"])
npm(["shrinkwrap", "--loglevel=error"])

const cli = join(dirname(packageJson), installed.bin["playwright-mcp"])
const server = spawn(process.execPath, [cli, ...TOOL_ARGUMENTS], {
  stdio: ["pipe", "pipe", "inherit"],
})
const pending = new Map()
let buffer = ""
server.stdout.setEncoding("utf8")
server.stdout.on("data", (chunk) => {
  buffer += chunk
  for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    const settle = pending.get(message.id)
    if (settle === undefined) continue
    pending.delete(message.id)
    settle(message)
  }
})
let ids = 0
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++ids
    pending.set(id, (message) =>
      message.error === undefined
        ? resolve(message.result)
        : reject(new Error(message.error.message)),
    )
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })

const initialized = await request("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "dsh-bot-connector-browser-generator", version: "1" },
})
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
const { tools } = await request("tools/list", {})
server.kill()

const generated = {
  package: PACKAGE,
  version,
  server: initialized.serverInfo,
  arguments: TOOL_ARGUMENTS,
  tools: tools.map(({ name, description, inputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    ...(annotations === undefined ? {} : { annotations }),
  })),
}
writeFileSync(`${root}src/generated/playwright-mcp.json`, `${JSON.stringify(generated, null, 2)}\n`)
console.log(`${PACKAGE} ${version}: ${tools.length} tools`)
