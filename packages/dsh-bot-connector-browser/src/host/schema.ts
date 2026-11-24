/**
 * An upstream tool's JSON Schema (Playwright MCP's, draft 2020-12 from zod)
 * in the subset DSH's tools take (type, oneOf, properties, required, boolean
 * additionalProperties, items, enum, const, and annotations). The
 * conversion only drops what the subset cannot say, never adds a
 * constraint; the server checks every call against its own schema anyway.
 * What is dropped is said in the description. An unknown keyword throws, so
 * that a new upstream version is looked at before it is offered.
 */
export type SchemaNode = { readonly [keyword: string]: unknown }

const ANNOTATIONS = new Set(["description", "title", "default", "examples"])
const KEPT = new Set(["type", "properties", "required", "enum", "const", "items"])

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const described = (node: SchemaNode, notes: readonly string[]) => {
  if (notes.length === 0) return node
  const note = notes.join("; ")
  return {
    ...node,
    description:
      typeof node.description === "string" && node.description !== ""
        ? `${node.description} (${note})`
        : `(${note})`,
  }
}

function convert(node: unknown, path: string): SchemaNode {
  if (!isNode(node)) throw new Error(`${path} is not a schema object`)
  const out: Record<string, unknown> = {}
  const notes: string[] = []
  for (const [key, value] of Object.entries(node)) {
    if (
      ANNOTATIONS.has(key) ||
      key === "type" ||
      key === "required" ||
      key === "enum" ||
      key === "const"
    ) {
      out[key] = value
    } else if (key === "$schema") {
    } else if (key === "properties") {
      if (!isNode(value)) throw new Error(`${path}.properties is not an object`)
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [
          name,
          convert(child, `${path}.properties.${name}`),
        ]),
      )
    } else if (key === "items") {
      out.items = convert(value, `${path}.items`)
    } else if (key === "anyOf") {
      out.oneOf = exclusiveBranches(value, path)
    } else if (key === "additionalProperties") {
      if (typeof value === "boolean") out.additionalProperties = value
      else notes.push(`every value: ${valueType(value, path)}`)
    } else if (key === "propertyNames") {
      if (!isNode(value) || value.type !== "string" || Object.keys(value).length !== 1) {
        throw new Error(`${path}.propertyNames is more than "any string"`)
      }
    } else if (key === "minimum") {
      notes.push(`at least ${String(value)}`)
    } else if (key === "maximum") {
      if (value !== Number.MAX_SAFE_INTEGER) notes.push(`at most ${String(value)}`)
    } else {
      throw new Error(`${path}.${key} is a keyword the conversion does not know`)
    }
  }
  for (const key of Object.keys(out)) {
    if (
      !KEPT.has(key) &&
      !ANNOTATIONS.has(key) &&
      key !== "oneOf" &&
      key !== "additionalProperties"
    ) {
      throw new Error(`${path}.${key} was kept by mistake`)
    }
  }
  return described(out, notes)
}

/** anyOf as oneOf: only when its branches have different types, so exactly one can match. */
function exclusiveBranches(value: unknown, path: string): readonly SchemaNode[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${path}.anyOf is not a list of at least two schemas`)
  }
  const branches = value.map((branch, index) => convert(branch, `${path}.anyOf[${index}]`))
  const types = branches.map((branch) => branch.type)
  if (types.some((type) => typeof type !== "string") || new Set(types).size !== types.length) {
    throw new Error(`${path}.anyOf has branches that may overlap`)
  }
  return branches
}

function valueType(value: unknown, path: string): string {
  if (!isNode(value) || typeof value.type !== "string" || Object.keys(value).length !== 1) {
    throw new Error(`${path}.additionalProperties is more than a type`)
  }
  return value.type
}

export function toolSchema(
  inputSchema: SchemaNode,
  tool: string,
): SchemaNode & { readonly type: "object" } {
  const converted = convert(inputSchema, tool)
  if (converted.type !== "object") throw new Error(`${tool}'s arguments are not an object`)
  return converted as SchemaNode & { readonly type: "object" }
}
