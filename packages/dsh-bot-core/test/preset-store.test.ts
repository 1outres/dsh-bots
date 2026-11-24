import { describe, expect, it } from "vitest"
import { botRecordSchema, mainOnBotPreset, parseOverlay } from "../src/host/domain"

const base = {
  name: "n",
  avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
  path: "/p",
  workspaceId: "w",
  createdAt: 1,
  updatedAt: 1,
}

describe("botRecordSchema with presets", () => {
  it("still parses a record from before bot presets", () => {
    expect(botRecordSchema.safeParse({ ...base, mainSessionId: "s" }).success).toBe(true)
  })

  it("parses a template, an overlay and the Main preset flag", () => {
    const record = {
      ...base,
      template: "helper-2",
      mainOnBotPreset: true,
      overlay: [
        {
          op: "add",
          row: { id: "web", name: "@x/web", config: { a: [1, null] } },
          after: "persona",
        },
        {
          op: "replace",
          id: "persona",
          row: { id: "persona", name: "@x/p", disabled: { __jsExpr: "true" } },
        },
        { op: "remove", id: "tool-bash" },
      ],
    }
    expect(botRecordSchema.parse(record)).toEqual(record)
  })

  it("still reads the earlier Main preset field", () => {
    const record = botRecordSchema.parse({ ...base, mainSessionId: "m", mainPreset: "bot-x" })
    expect(mainOnBotPreset(record)).toBe(true)
    expect(mainOnBotPreset(botRecordSchema.parse({ ...base, mainSessionId: "m" }))).toBe(false)
  })

  // Stored loosely: a record must never be dropped because its preset fields
  // no longer validate (a later op, a stricter rule); composition reports it.
  it.each([
    ["a bad template id", { template: "Bad_Id" }],
    ["an unknown op", { overlay: [{ op: "move", id: "x" }] }],
    ["an extra op field", { overlay: [{ op: "remove", id: "x", row: {} }] }],
    ["a row without name", { overlay: [{ op: "add", row: { id: "x" } }] }],
  ])("keeps a record with %s", (_label, extra) => {
    expect(botRecordSchema.safeParse({ ...base, ...extra }).success).toBe(true)
  })
})

describe("parseOverlay", () => {
  const outside = { allowedPlugins: new Set(["@x/p", "@deepseek-ai/dsh-mcp-client"]) }

  it("returns a valid overlay and names the first bad op", () => {
    expect(parseOverlay([{ op: "remove", id: "x" }], outside)).toEqual([{ op: "remove", id: "x" }])
    expect(() => parseOverlay([{ op: "remove", id: "x" }, { op: "remove" }], outside)).toThrow(
      "invalid overlay at 1",
    )
    expect(() => parseOverlay({}, outside)).toThrow("invalid overlay")
  })

  it.each([
    ["an unknown op", [{ op: "move", id: "x" }]],
    ["an extra op field", [{ op: "remove", id: "x", row: {} }]],
    ["a row without name", [{ op: "add", row: { id: "x" } }]],
    ["a replace that renames", [{ op: "replace", id: "x", row: { id: "y", name: "p" } }]],
  ])("refuses %s", (_label, overlay) => {
    expect(() => parseOverlay(overlay, outside)).toThrow("invalid overlay")
  })

  it("refuses Loader expressions from outside, keeps them when trusted", () => {
    const overlay = [
      {
        op: "add",
        row: { id: "x", name: "@x/p", config: { deep: [{ v: { __jsExpr: "process.exit()" } }] } },
      },
    ]
    expect(() => parseOverlay(overlay, outside)).toThrow(
      "at 0.row.config.deep.0.v: Loader expressions",
    )
    expect(parseOverlay(overlay, { trusted: true })).toEqual(overlay)
  })

  it.each([
    ["an absolute path", "/home/u/.dsh/bots/a/evil.mjs", "path or URL"],
    ["a relative path", "./evil.mjs", "path or URL"],
    ["a file URL", "file:///tmp/evil.mjs", "path or URL"],
    ["a data URL", "data:text/javascript,1", "path or URL"],
    ["a Windows path", "C:\\evil.mjs", "path or URL"],
    ["the include row", "cordis:include", "path or URL"],
    ["the include plugin", "@deepseek-ai/cordis-plugin-include", "loads other entries"],
    ["the loader", "@deepseek-ai/cordis-plugin-loader", "loads other entries"],
    ["an unlisted package", "@evil/plugin", "not allowed"],
  ])("refuses %s as a plugin from outside", (_label, name, message) => {
    const overlay = [{ op: "add", row: { id: "x", name } }]
    expect(() => parseOverlay(overlay, outside)).toThrow(message)
    expect(parseOverlay(overlay, { trusted: true })).toEqual(overlay)
  })

  it("checks the rows nested in a group, and allows the group itself", () => {
    const group = (name: string) => [
      {
        op: "add",
        row: {
          id: "g",
          name: "cordis:group",
          group: true,
          config: [{ id: "inner", name }],
        },
      },
    ]
    expect(parseOverlay(group("@x/p"), outside)).toHaveLength(1)
    expect(() => parseOverlay(group("/tmp/evil.mjs"), outside)).toThrow('row 1 "inner"')
  })

  it("refuses even a listed package whose name loads entries", () => {
    const allowed = { allowedPlugins: new Set(["@deepseek-ai/cordis-plugin-include"]) }
    expect(() =>
      parseOverlay(
        [{ op: "add", row: { id: "x", name: "@deepseek-ai/cordis-plugin-include" } }],
        allowed,
      ),
    ).toThrow("loads other entries")
  })
})

describe("parseOverlay: nested rows and Host paths", () => {
  const outside = { allowedPlugins: new Set(["@x/p", "@deepseek-ai/dsh-agent-instructions"]) }

  it("checks the children of a cordis:group row even without group: true", () => {
    const overlay = [
      {
        op: "add",
        row: { id: "g", name: "cordis:group", config: [{ id: "inner", name: "/tmp/evil.mjs" }] },
      },
    ]
    expect(() => parseOverlay(overlay, outside)).toThrow("path or URL")
  })

  it("refuses config keys that point an allowed plugin at Host paths", () => {
    for (const key of ["dshHome", "agentsHome"]) {
      const overlay = [
        {
          op: "replace",
          id: "agent-instructions",
          row: {
            id: "agent-instructions",
            name: "@deepseek-ai/dsh-agent-instructions",
            config: { [key]: "/etc" },
          },
        },
      ]
      expect(() => parseOverlay(overlay, outside)).toThrow(`config "${key}"`)
    }
    const fine = [
      {
        op: "replace",
        id: "agent-instructions",
        row: {
          id: "agent-instructions",
          name: "@deepseek-ai/dsh-agent-instructions",
          config: { maxBytes: 1024 },
        },
      },
    ]
    expect(parseOverlay(fine, outside)).toHaveLength(1)
  })
})
