import type { IncusClient } from "./incus"

export function switchableIncusClient(current: () => Promise<IncusClient>): IncusClient {
  const on = <Name extends keyof IncusClient>(name: Name): IncusClient[Name] => {
    const call = async (...args: readonly unknown[]) => {
      const client = await current()
      return Reflect.apply(client[name], client, args)
    }
    return call as IncusClient[Name]
  }
  return {
    server: on("server"),
    instance: on("instance"),
    instances: on("instances"),
    create: on("create"),
    patchConfig: on("patchConfig"),
    update: on("update"),
    setState: on("setState"),
    destroy: on("destroy"),
    exec: on("exec"),
    hostResources: on("hostResources"),
    projectConfig: on("projectConfig"),
    profile: on("profile"),
    profiles: on("profiles"),
    hasNetwork: on("hasNetwork"),
    poolSpace: on("poolSpace"),
    volume: on("volume"),
    volumes: on("volumes"),
    createVolume: on("createVolume"),
    patchVolume: on("patchVolume"),
    deleteVolume: on("deleteVolume"),
    importImage: on("importImage"),
    image: on("image"),
    deleteImage: on("deleteImage"),
    alias: on("alias"),
    setAlias: on("setAlias"),
    deleteAlias: on("deleteAlias"),
    trustWithToken: on("trustWithToken"),
  }
}
