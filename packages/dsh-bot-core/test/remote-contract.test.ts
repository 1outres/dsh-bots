import { readFileSync } from "node:fs"
import { describe, expect, expectTypeOf, it } from "vitest"
import { BOT_CORE_REMOTE } from "../src/client/remote"
import { HOST_REMOTE_CONTRIBUTION } from "../src/host/remote-contract"
import type { BotsApi } from "../src/shared/bots"
import type { BotChannelsApi } from "../src/shared/channels"
import type { BotFilesApi } from "../src/shared/files-api"
import {
  REMOTE_ENDPOINTS,
  REMOTE_METHODS,
  REMOTE_NAMESPACES,
  REMOTE_PACKAGE,
  type RemoteMethodContract,
} from "../src/shared/remote-contract"

/** The parameter names each `@Remote` method of host/remote.ts declares, by endpoint. */
function sourceSignatures(): Map<string, string[]> {
  const source = readFileSync(new URL("../src/host/remote.ts", import.meta.url), "utf8")
  const constants = new Map(
    [...source.matchAll(/export const (\w+) = "(\w+)"/g)].map(([, name, value]) => [name, value]),
  )
  const signatures = new Map<string, string[]>()
  for (const body of source.split(/\nexport class /).slice(1)) {
    const key = /super\(ctx, (\w+)\)/.exec(body)?.[1]
    const namespace = key === undefined ? undefined : constants.get(key)
    if (namespace === undefined) continue
    for (const [, method, parameters] of body.matchAll(
      /@Remote(?:\([^)]*\))?\s+(?:async\s+)?\*?(\w+)\(([^)]*)\)/g,
    )) {
      signatures.set(
        `${namespace}/${method}`,
        (parameters ?? "")
          .split(",")
          .map((parameter) => parameter.trim())
          .filter((parameter) => parameter.length > 0)
          .map((parameter) => /^(\w+)/.exec(parameter)?.[1] ?? parameter),
      )
    }
  }
  return signatures
}

const wireOf = (contract: RemoteMethodContract) => contract.parameters.map(({ name }) => name)

describe("bot-core's Remote contract", () => {
  it("names exactly the methods of each Host API", () => {
    expectTypeOf<keyof typeof REMOTE_METHODS.botFiles>().toEqualTypeOf<keyof BotFilesApi>()
    expectTypeOf<keyof typeof REMOTE_METHODS.bots>().toEqualTypeOf<keyof BotsApi>()
    expectTypeOf<keyof typeof REMOTE_METHODS.botChannels>().toEqualTypeOf<keyof BotChannelsApi>()
    expect(Object.keys(REMOTE_METHODS).sort()).toEqual([...REMOTE_NAMESPACES].sort())
  })

  it("gives every endpoint one id under the package", () => {
    const ids = REMOTE_ENDPOINTS.map((endpoint) => endpoint.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const { id, namespace, method } of REMOTE_ENDPOINTS) {
      expect(id).toBe(`${REMOTE_PACKAGE}#${namespace}/${method}`)
    }
  })

  it("lists the Host methods' parameters in their declared order, signal last when cancellable", () => {
    const declared = sourceSignatures()
    expect([...declared.keys()].sort()).toEqual(
      REMOTE_ENDPOINTS.map(({ namespace, method }) => `${namespace}/${method}`).sort(),
    )
    for (const { namespace, method, contract } of REMOTE_ENDPOINTS) {
      expect(declared.get(`${namespace}/${method}`), `${namespace}/${method}`).toEqual([
        ...wireOf(contract),
        ...(contract.cancellable ? ["signal"] : []),
      ])
    }
  })
})

describe("bot-core's Remote faces", () => {
  it("mount the contract in the browser", () => {
    expect(BOT_CORE_REMOTE.package).toBe(REMOTE_PACKAGE)
    expect(
      BOT_CORE_REMOTE.descriptors.map((descriptor) => ({
        id: descriptor.id,
        service: descriptor.service,
        wire: descriptor.parameters.map((parameter) => parameter.wire),
        stream: descriptor.mode === "stream",
        cancellable: descriptor.cancellation?.parameter === "signal",
      })),
    ).toEqual(
      REMOTE_ENDPOINTS.map(({ id, namespace, contract }) => ({
        id,
        service: namespace,
        wire: wireOf(contract),
        stream: contract.stream === true,
        cancellable: contract.cancellable === true,
      })),
    )
  })

  it("register the contract on the Host, an optional argument as one the caller may omit", () => {
    expect(HOST_REMOTE_CONTRIBUTION).toMatchObject({ package: REMOTE_PACKAGE, face: "host" })
    expect(
      HOST_REMOTE_CONTRIBUTION.invocations.map((descriptor) => ({
        id: descriptor.id,
        service: descriptor.service,
        namespace: descriptor.namespace,
        method: descriptor.method,
        parameters: descriptor.parameters.map(({ name, wire, source, acceptsUndefined }) => ({
          name,
          wire,
          source,
          omissible: acceptsUndefined === true,
        })),
        stream: descriptor.mode === "stream",
        cancellable: descriptor.cancellation?.parameter === "signal",
      })),
    ).toEqual(
      REMOTE_ENDPOINTS.map(({ id, namespace, method, contract }) => ({
        id,
        service: namespace,
        namespace,
        method,
        parameters: contract.parameters.map(({ name, optional }) => ({
          name,
          wire: name,
          source: "json",
          omissible: optional === true,
        })),
        stream: contract.stream === true,
        cancellable: contract.cancellable === true,
      })),
    )
  })
})
