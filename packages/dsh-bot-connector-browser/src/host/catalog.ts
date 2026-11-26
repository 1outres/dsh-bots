import generated from "../generated/playwright-mcp.json"
import { type McpTool, parseTool } from "./mcp/protocol"

export interface GeneratedServer {
  readonly package: string
  readonly version: string
  readonly server: { readonly name: string; readonly version: string }
  readonly arguments: readonly string[]
  readonly tools: readonly McpTool[]
}

export const NOT_OFFERED = ["browser_close", "browser_install"] as const
export const DISALLOWED = ["browser_run_code_unsafe"] as const

const UPSTREAM_PREFIX = "browser_"

export function parseGeneratedServer(value: unknown): GeneratedServer {
  const record = value as Partial<Record<keyof GeneratedServer, unknown>>
  const server = record.server as Partial<GeneratedServer["server"]> | undefined
  if (
    typeof record.package !== "string" ||
    typeof record.version !== "string" ||
    typeof server?.name !== "string" ||
    typeof server.version !== "string" ||
    !Array.isArray(record.arguments) ||
    !record.arguments.every((argument) => typeof argument === "string") ||
    !Array.isArray(record.tools)
  ) {
    throw new Error("src/generated/playwright-mcp.json is malformed; run the generator again")
  }
  return {
    package: record.package,
    version: record.version,
    server: { name: server.name, version: server.version },
    arguments: record.arguments as string[],
    tools: record.tools.map((tool, index) => parseTool(tool, `generated tool ${index + 1}`)),
  }
}

export const GENERATED_SERVER = parseGeneratedServer(generated)

export interface OfferedTool {
  readonly upstream: McpTool
  readonly name: string
  readonly permission: "allow" | "disallow"
  readonly readOnly: boolean
}

export function offeredTools(tools: readonly McpTool[]): readonly OfferedTool[] {
  return tools
    .filter((tool) => !(NOT_OFFERED as readonly string[]).includes(tool.name))
    .map((tool) => {
      if (!tool.name.startsWith(UPSTREAM_PREFIX)) {
        throw new Error(`Playwright MCP's tool ${tool.name} is not named ${UPSTREAM_PREFIX}…`)
      }
      return {
        upstream: tool,
        name: tool.name.slice(UPSTREAM_PREFIX.length),
        permission: (DISALLOWED as readonly string[]).includes(tool.name) ? "disallow" : "allow",
        readOnly: tool.annotations?.readOnlyHint === true,
      }
    })
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  )
}

export function toolDifferences(
  expected: readonly McpTool[],
  listed: readonly McpTool[],
): readonly string[] {
  const byName = new Map(listed.map((tool) => [tool.name, tool]))
  const differences: string[] = []
  for (const tool of expected) {
    const other = byName.get(tool.name)
    if (other === undefined) differences.push(`${tool.name} is missing`)
    else if (JSON.stringify(canonical(other)) !== JSON.stringify(canonical(tool))) {
      differences.push(`${tool.name} changed`)
    }
    byName.delete(tool.name)
  }
  for (const name of byName.keys()) differences.push(`${name} is new`)
  return differences
}
