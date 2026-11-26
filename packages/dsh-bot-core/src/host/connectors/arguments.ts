import {
  assertSupportedJsonSchema,
  type JsonSchemaNode,
  parameterSchemaSpecToJsonSchema,
  validateJsonSchemaValue,
} from "@deepseek-ai/dsh-tools"
import type { BotConnectorToolDefinition } from "../../connector-contract"

export type ArgumentsCheck = (args: unknown) => readonly string[]

export interface CompiledArguments {
  readonly schema: JsonSchemaNode
  readonly check: ArgumentsCheck
}

export function compileArguments(tool: BotConnectorToolDefinition<unknown>): CompiledArguments {
  const { parameters, inputSchema } = tool
  if ((parameters === undefined) === (inputSchema === undefined)) {
    throw new Error("it needs exactly one of parameters and inputSchema")
  }
  let schema: JsonSchemaNode
  if (parameters !== undefined) {
    schema = parameterSchemaSpecToJsonSchema(parameters)
  } else {
    const candidate: unknown = inputSchema
    assertSupportedJsonSchema(candidate)
    if ((candidate as { type?: unknown }).type !== "object") {
      throw new Error('its inputSchema must have type "object"')
    }
    schema = candidate
  }
  return { schema, check: (args) => validateJsonSchemaValue(schema, args, "arguments") }
}
