import {
  assertSupportedJsonSchema,
  type JsonSchemaNode,
  parameterSchemaSpecToJsonSchema,
  validateJsonSchemaValue,
} from "@deepseek-ai/dsh-tools"
import type { BotConnectorToolDefinition } from "../../connector-contract"

/** Checks a call's arguments against a tool's schema, as dsh-tools validates a tool call. */
export type ArgumentsCheck = (args: unknown) => readonly string[]

/** A tool's arguments schema as the model sees it, and its check. */
export interface CompiledArguments {
  readonly schema: JsonSchemaNode
  readonly check: ArgumentsCheck
}

/**
 * Compile a tool's `parameters` (dsh-tools' schema) or `inputSchema` (JSON
 * Schema) with dsh-tools' own compiler.
 * @throws when it has neither or both, or the schema is not one dsh-tools supports.
 */
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
