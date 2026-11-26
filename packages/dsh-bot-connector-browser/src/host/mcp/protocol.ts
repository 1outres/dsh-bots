export const PROTOCOL_VERSION = "2025-06-18"

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: { readonly type: "object"; readonly [keyword: string]: unknown }
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly [hint: string]: unknown }
}

export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string }

export interface McpCallResult {
  readonly content: readonly McpContent[]
  readonly isError: boolean
}

export class McpProtocolError extends Error {
  constructor(message: string) {
    super(`Playwright MCP answered something unexpected: ${message}`)
    this.name = "McpProtocolError"
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function parseTool(value: unknown, where: string): McpTool {
  if (!isRecord(value)) throw new McpProtocolError(`${where} is not an object`)
  const { name, description, inputSchema, annotations } = value
  if (typeof name !== "string" || name === "") throw new McpProtocolError(`${where} has no name`)
  if (typeof description !== "string") throw new McpProtocolError(`${name} has no description`)
  if (!isRecord(inputSchema) || inputSchema.type !== "object") {
    throw new McpProtocolError(`${name} has no object input schema`)
  }
  if (annotations !== undefined && !isRecord(annotations)) {
    throw new McpProtocolError(`${name} has annotations that are not an object`)
  }
  return {
    name,
    description,
    inputSchema: inputSchema as McpTool["inputSchema"],
    ...(annotations === undefined ? {} : { annotations: annotations as McpTool["annotations"] }),
  }
}

export function parseToolList(value: unknown): readonly McpTool[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    throw new McpProtocolError("tools/list has no tools")
  }
  if (value.nextCursor !== undefined) {
    throw new McpProtocolError("tools/list answered in pages, which the connector does not read")
  }
  return value.tools.map((tool, index) => parseTool(tool, `tool ${index + 1}`))
}

export function parseCallResult(value: unknown): McpCallResult {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new McpProtocolError("a tool's result has no content")
  }
  if (value.isError !== undefined && typeof value.isError !== "boolean") {
    throw new McpProtocolError("a tool's isError is not true or false")
  }
  const content = value.content.map((block, index): McpContent => {
    if (!isRecord(block)) throw new McpProtocolError(`content ${index + 1} is not an object`)
    if (block.type === "text" && typeof block.text === "string") {
      return { type: "text", text: block.text }
    }
    if (
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      return { type: "image", data: block.data, mimeType: block.mimeType }
    }
    throw new McpProtocolError(`content ${index + 1} is neither text nor an image`)
  })
  return { content, isError: value.isError === true }
}

export function parseInitialize(value: unknown): {
  readonly name: string
  readonly version: string
} {
  if (!isRecord(value) || !isRecord(value.serverInfo)) {
    throw new McpProtocolError("initialize has no serverInfo")
  }
  const { name, version } = value.serverInfo
  if (typeof name !== "string" || typeof version !== "string") {
    throw new McpProtocolError("initialize has no server name and version")
  }
  if (typeof value.protocolVersion !== "string") {
    throw new McpProtocolError("initialize has no protocol version")
  }
  return { name, version }
}
