import type { IncusClient } from "../../src/host/incus"

/** An IncusClient with the given methods; any other one fails when called. */
export function incusWith(methods: Partial<IncusClient>): IncusClient {
  return new Proxy(methods as IncusClient, {
    get: (target, method) =>
      Reflect.get(target, method) ??
      (() => Promise.reject(new Error(`IncusClient.${String(method)} is not used here`))),
  })
}
