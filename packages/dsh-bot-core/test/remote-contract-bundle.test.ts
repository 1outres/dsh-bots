import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Context } from "@deepseek-ai/cordis"
import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol"
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol"
import { build } from "esbuild"
import { beforeAll, describe, expect, it } from "vitest"
// @ts-expect-error
import { hostBuildOptions } from "../../../scripts/build-options.mjs"
import { BOT_CORE_REMOTE } from "../src/client/remote"
import type { HOST_REMOTE_CONTRIBUTION, REMOTE_SERVICES } from "../src/index"

interface BuiltHost {
  readonly REMOTE_SERVICES: typeof REMOTE_SERVICES
  readonly HOST_REMOTE_CONTRIBUTION: typeof HOST_REMOTE_CONTRIBUTION
}

interface Wire {
  readonly arguments: readonly string[]
  readonly stream: boolean
  readonly cancellable: boolean
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const outDir = join(packageRoot, "node_modules", ".cache", "remote-contract-bundle")

async function buildHost(): Promise<BuiltHost> {
  const outfile = join(outDir, "index.js")
  await mkdir(outDir, { recursive: true })
  await build({
    ...hostBuildOptions(join(packageRoot, "src", "index.ts"), outfile),
    logLevel: "silent",
  })
  return (await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)) as BuiltHost
}

function sourceParameterNames(method: unknown): string[] {
  const source = Function.prototype.toString.call(method)
  const open = source.indexOf("(")
  const body = source.slice(open + 1, source.indexOf(")", open + 1)).trim()
  return body.length === 0 ? [] : body.split(",").map((part) => part.trim())
}

const strictWire = (descriptor: InvocationDescriptor): Wire => ({
  arguments: descriptor.parameters.map((parameter) => parameter.wire),
  stream: descriptor.mode === "stream",
  cancellable: descriptor.cancellation !== undefined,
})

function sourceWire(method: unknown, mode: "stream" | undefined): Wire {
  const names = sourceParameterNames(method)
  const cancellable = names.at(-1) === "signal"
  return {
    arguments: cancellable ? names.slice(0, -1) : names,
    stream: mode === "stream",
    cancellable,
  }
}

const clientWire = new Map(
  BOT_CORE_REMOTE.descriptors.map((descriptor): [string, Wire] => [
    `${descriptor.namespace}/${descriptor.method}`,
    {
      arguments: descriptor.parameters.map((parameter) => parameter.wire),
      stream: descriptor.mode === "stream",
      cancellable: descriptor.cancellation !== undefined,
    },
  ]),
)

describe("the built Host bundle's Remote", () => {
  let host: BuiltHost
  const served = new Map<string, { strict: boolean; wire: Wire; arity: number }>()

  beforeAll(async () => {
    host = await buildHost()
    const strict = new Map(
      host.HOST_REMOTE_CONTRIBUTION.invocations.map(
        (descriptor): [string, InvocationDescriptor] => [
          `${descriptor.namespace}/${descriptor.method}`,
          descriptor,
        ],
      ),
    )
    for (const [namespace, Service] of Object.entries(host.REMOTE_SERVICES)) {
      const Constructor = Service as unknown as new (ctx: Context, ...rest: unknown[]) => object
      const service = new Constructor(new Context(), {}, () => () => {})
      const prototype = Object.getPrototypeOf(service) as object
      for (const marker of remoteMethods(service)) {
        const endpoint = `${namespace}/${marker.exportName ?? marker.method}`
        const implementation: unknown = Reflect.get(prototype, marker.method)
        const declared = strict.get(endpoint)
        served.set(endpoint, {
          strict: declared !== undefined,
          wire:
            declared === undefined ? sourceWire(implementation, marker.mode) : strictWire(declared),
          arity: (implementation as (...args: unknown[]) => unknown).length,
        })
      }
    }
  }, 60_000)

  it("serves exactly the endpoints the browser mounts", () => {
    expect([...served.keys()].sort()).toEqual([...clientWire.keys()].sort())
  })

  it("dispatches every endpoint by its declared definition, never by parameter identifiers", () => {
    const derived = [...served].filter(([, entry]) => !entry.strict).map(([endpoint]) => endpoint)
    expect(derived).toEqual([])
  })

  it("takes the arguments the browser sends, by name and position", () => {
    for (const [endpoint, entry] of served) {
      expect(entry.wire, endpoint).toEqual(clientWire.get(endpoint))
      expect(entry.arity, endpoint).toBe(
        entry.wire.arguments.length + (entry.wire.cancellable ? 1 : 0),
      )
    }
  })
})
