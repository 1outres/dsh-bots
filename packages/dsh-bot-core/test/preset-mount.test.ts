/**
 * Mount composed bot presets with the real Cordis Loader: what the checks in
 * compose.ts assume about how the Loader mounts rows holds.
 */
import { Context, Service } from "@deepseek-ai/cordis"
import { Group, Loader } from "@deepseek-ai/cordis-plugin-loader"
import { describe, expect, it } from "vitest"
import { composeBotPreset } from "../src/host/preset/compose"
import type { BotOverlay, BotTemplate, PluginRow } from "../src/shared/preset"

/** One `fs` service implementation, tagged with where it comes from. */
class FakeFs extends Service {
  kind: string
  constructor(ctx: Context, config: { kind: string }) {
    super(ctx, "fs")
    this.kind = config.kind
  }
}

/** A Loader whose rows import from a fixed module table, with `cordis:group` built in. */
function mount() {
  const seen: string[] = []
  const modules: Record<string, unknown> = {
    "@test/fs": FakeFs,
    "@test/user": {
      name: "user",
      inject: ["fs"],
      apply(ctx: Context, config: { tag: string }) {
        seen.push(`${config.tag}:${(ctx.get("fs") as unknown as FakeFs).kind}`)
      },
    },
  }
  class TestLoader extends Loader {
    constructor(ctx: Context) {
      super(ctx)
      this.builtins.group = Group
    }
    override import(name: string) {
      return name.startsWith("cordis:")
        ? this.builtins[name.slice(7)]
        : Promise.resolve(modules[name])
    }
    commit() {}
  }
  const ctx = new Context()
  return {
    seen,
    async load(rows: readonly PluginRow[]) {
      await ctx.plugin(TestLoader)
      const loader = (ctx as unknown as { loader: Loader }).loader
      await loader.root.update([
        { id: "host-fs", name: "@test/fs", config: { kind: "host" } },
        { id: "host-user", name: "@test/user", config: { tag: "host" } },
        ...(rows as never[]),
      ])
      await loader.await()
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
  }
}

const template: BotTemplate = {
  id: "t",
  plugins: [{ id: "tool", name: "@test/user", config: { tag: "tool" } }],
}
const environment = {
  id: "vm",
  isolate: ["fs"],
  rows: [{ id: "env-fs", name: "@test/fs", config: { kind: "env" } }],
}
const compose = (overlay: BotOverlay = []) =>
  composeBotPreset({
    botId: "b1",
    botName: "B",
    template,
    overlay,
    environment,
    allowedHostTools: new Set(),
    web: { backend: "exa", search: true, fetch: true },
    seal: (revision) => revision,
  })

describe("composed presets under the real Loader", () => {
  it("gives every composed row the environment's fs, and the Host keeps its own", async () => {
    const result = compose([
      {
        op: "add",
        row: {
          id: "nested",
          name: "cordis:group",
          group: true,
          config: [{ id: "deep", name: "@test/user", config: { tag: "deep" } }],
        },
      },
    ])
    if (!result.ok) throw new Error(result.problem)
    const { seen, load } = mount()
    await load(result.preset.plugins)
    expect(seen.sort()).toEqual(["deep:env", "host:host", "tool:env"])
  })

  it("mounts a cordis:group row's children without group: true, so compose refuses it", async () => {
    const { seen, load } = mount()
    await load([
      {
        id: "flagless",
        name: "cordis:group",
        config: [{ id: "hidden", name: "@test/user", config: { tag: "hidden" } }],
      },
    ])
    expect(seen).toContain("hidden:host")
    const refused = compose([
      {
        op: "add",
        row: {
          id: "flagless",
          name: "cordis:group",
          config: [{ id: "hidden", name: "@test/user" }],
        },
      },
    ])
    expect(refused).toMatchObject({ ok: false, problem: expect.stringContaining("group: true") })
  })
})
