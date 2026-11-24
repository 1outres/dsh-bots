import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  GENERATED_SERVER,
  offeredTools,
  parseGeneratedServer,
  toolDifferences,
} from "../src/host/catalog"
import { toolSchema } from "../src/host/schema"

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"))

describe("the generated tools", () => {
  it("come from the pinned Playwright MCP that the VM installs and this package lists them with", () => {
    const vm = json("../vm/mcp/package.json")
    const shrinkwrap = json("../vm/mcp/npm-shrinkwrap.json")
    const manifest = json("../package.json")
    expect(GENERATED_SERVER.package).toBe("@playwright/mcp")
    expect(vm.dependencies).toEqual({ "@playwright/mcp": GENERATED_SERVER.version })
    expect(shrinkwrap.packages["node_modules/@playwright/mcp"].version).toBe(
      GENERATED_SERVER.version,
    )
    expect(shrinkwrap.packages[""].dependencies).toEqual(vm.dependencies)
    expect(manifest.devDependencies["@playwright/mcp"]).toBe(GENERATED_SERVER.version)
    expect(GENERATED_SERVER.arguments).toEqual(["--caps", "vision,pdf", "--no-webmcp"])
  })

  it("are offered as browser_<upstream> without close and install, run_code_unsafe disallowed", () => {
    const offered = offeredTools(GENERATED_SERVER.tools)
    const names = offered.map((tool) => tool.name)
    expect(names).not.toContain("close")
    expect(names).not.toContain("install")
    expect(names).toContain("navigate")
    expect(offered.find((tool) => tool.name === "run_code_unsafe")?.permission).toBe("disallow")
    expect(offered.filter((tool) => tool.permission === "disallow")).toHaveLength(1)
    expect(
      offered
        .filter((tool) => tool.readOnly)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([
      "console_messages",
      "find",
      "network_request",
      "network_requests",
      "pdf_save",
      "snapshot",
      "take_screenshot",
      "wait_for",
    ])
    expect(() => offeredTools([{ ...GENERATED_SERVER.tools[1], name: "other" } as never])).toThrow(
      /not named browser_/,
    )
  })

  it("convert to DSH's schema subset", () => {
    for (const tool of GENERATED_SERVER.tools) {
      expect(JSON.stringify(toolSchema(tool.inputSchema, tool.name))).not.toMatch(
        /"\$schema"|"anyOf"|"minimum"|"propertyNames"/,
      )
    }
  })

  it("refuse a malformed generated file", () => {
    expect(() => parseGeneratedServer({ ...GENERATED_SERVER, arguments: [1] })).toThrow(/malformed/)
  })
})

describe("the tools a server lists", () => {
  const tools = GENERATED_SERVER.tools
  it("match when they are the same, in any order and key order", () => {
    const shuffled = [...tools].reverse().map((tool) => JSON.parse(JSON.stringify(tool)))
    expect(toolDifferences(tools, shuffled)).toEqual([])
  })

  it("name what is missing, changed or new", () => {
    const [first, second, ...rest] = tools
    const listed = [
      { ...second, description: "other" },
      ...rest,
      { name: "browser_new", description: "", inputSchema: { type: "object" } },
    ] as never
    expect(toolDifferences(tools, listed)).toEqual([
      `${first?.name} is missing`,
      `${second?.name} changed`,
      "browser_new is new",
    ])
  })
})

describe("the schema conversion", () => {
  it("drops what the subset cannot say and says it in the description", () => {
    expect(
      toolSchema(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            index: {
              type: "integer",
              minimum: 1,
              maximum: Number.MAX_SAFE_INTEGER,
              description: "Index",
            },
            color: {
              description: "Color",
              anyOf: [{ type: "string", enum: ["dark"] }, { type: "null" }],
            },
            data: {
              type: "object",
              propertyNames: { type: "string" },
              additionalProperties: { type: "string" },
            },
          },
          required: ["index"],
          additionalProperties: false,
        },
        "t",
      ),
    ).toEqual({
      type: "object",
      properties: {
        index: { type: "integer", description: "Index (at least 1)" },
        color: {
          description: "Color",
          oneOf: [{ type: "string", enum: ["dark"] }, { type: "null" }],
        },
        data: { type: "object", description: "(every value: string)" },
      },
      required: ["index"],
      additionalProperties: false,
    })
  })

  it("refuses what it does not know or cannot convert faithfully", () => {
    const object = (property: object) => ({ type: "object", properties: { x: property } })
    expect(() => toolSchema(object({ type: "string", pattern: "a" }), "t")).toThrow(/pattern/)
    expect(() =>
      toolSchema(object({ anyOf: [{ type: "string" }, { type: "string", enum: ["a"] }] }), "t"),
    ).toThrow(/overlap/)
    expect(() => toolSchema({ type: "string" }, "t")).toThrow(/not an object/)
  })
})
