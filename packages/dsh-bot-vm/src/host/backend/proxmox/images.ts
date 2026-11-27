import type { ImageBackend } from "../contract"
import type { ProxmoxClient } from "./client"
import type { Inventory, Owned, PoolVm } from "./inventory"
import { diskEntries, importFile, importVolid, templateParams } from "./layout"
import { descriptionOf, type ImageMeta } from "./meta"
import { withNewVmid } from "./vmid"

export interface UnpackedImage {
  readonly rootfs: Promise<{ readonly bytes: number; readonly body: AsyncIterable<Uint8Array> }>
  readonly fingerprint: Promise<string>
}

export type ImageUnpacker = (tarball: AsyncIterable<Uint8Array>) => UnpackedImage

export interface Images extends ImageBackend {
  template(alias: string, signal?: AbortSignal): Promise<number>
  release(template: number, signal?: AbortSignal): Promise<void>
}

export interface ImagesOptions {
  readonly client: ProxmoxClient
  readonly inventory: Inventory
  readonly pool: string
  readonly storage: string
  readonly bridge: string
  readonly owner: string
  readonly uploadTimeoutMs: number
  readonly unpack: ImageUnpacker
}

const titleOf = (fingerprint: string) =>
  `dsh-bots: the bots' base image ${fingerprint}; bot VMs are linked clones of it`

export const templateNameOf = (fingerprint: string) => `dsh-bots-image-${fingerprint.slice(0, 12)}`

const clonedFrom = (template: number) => (vm: PoolVm) =>
  !vm.template &&
  diskEntries(vm.config).some(([, value]) => value.includes(`:${template}/base-${template}-`))

export function createImages(options: ImagesOptions): Images {
  const { client, inventory, storage } = options

  const withMeta = (found: Owned<ImageMeta>, meta: ImageMeta, signal?: AbortSignal) =>
    client.configure(
      found.vmid,
      { description: descriptionOf(titleOf(meta.fingerprint), meta) },
      signal,
    )

  async function byFingerprint(fingerprint: string, signal?: AbortSignal) {
    return (await inventory.images(signal)).find((image) => image.meta.fingerprint === fingerprint)
  }

  async function byAlias(alias: string, signal?: AbortSignal) {
    const found = (await inventory.images(signal)).filter((image) =>
      image.meta.aliases.includes(alias),
    )
    if (found.length > 1) {
      throw new Error(
        `the base image name "${alias}" is on ${found.length} templates (${found.map((image) => image.vmid).join(", ")})`,
      )
    }
    return found[0]
  }

  async function removeIfUnused(found: Owned<ImageMeta>, signal?: AbortSignal): Promise<void> {
    if (found.meta.aliases.length > 0) return
    if ((await inventory.vms(signal)).some(clonedFrom(found.vmid))) return
    await client.destroy(found.vmid, signal)
  }

  async function makeTemplate(fingerprint: string, signal?: AbortSignal): Promise<void> {
    const meta: ImageMeta = { kind: "image", owner: options.owner, fingerprint, aliases: [] }
    const vmid = await withNewVmid(
      client,
      (id) =>
        client.createVm(
          templateParams({
            vmid: id,
            name: templateNameOf(fingerprint),
            pool: options.pool,
            storage,
            bridge: options.bridge,
            description: descriptionOf(titleOf(fingerprint), meta),
            importVolid: importVolid(storage, fingerprint),
          }),
          signal,
        ),
      signal,
    )
    await client.template(vmid, signal)
  }

  return {
    target: async (alias, signal) => (await byAlias(alias, signal))?.meta.fingerprint,
    has: async (fingerprint, signal) => (await byFingerprint(fingerprint, signal)) !== undefined,
    async upload(source, signal) {
      const unpacked = options.unpack(source.body)
      unpacked.fingerprint.catch(() => {})
      const rootfs = await unpacked.rootfs
      await client.upload(
        storage,
        "import",
        { name: importFile(source.fingerprint), bytes: rootfs.bytes, body: rootfs.body },
        options.uploadTimeoutMs,
        signal,
      )
      const fingerprint = await unpacked.fingerprint
      if (
        fingerprint === source.fingerprint &&
        (await byFingerprint(fingerprint, signal)) === undefined
      ) {
        await makeTemplate(fingerprint, signal)
      }
      return fingerprint
    },
    async discard(fingerprint, signal) {
      const found = await byFingerprint(fingerprint, signal)
      if (found !== undefined) await removeIfUnused(found, signal)
    },
    async point(alias, fingerprint, signal) {
      const templates = await inventory.images(signal)
      const target = templates.find((image) => image.meta.fingerprint === fingerprint)
      if (target === undefined) throw new Error(`no template holds the base image ${fingerprint}`)
      const old = templates.find((image) => image.meta.aliases.includes(alias))?.meta.fingerprint
      for (const image of templates) {
        const keep = image.meta.aliases.filter((name) => name !== alias)
        const aliases = image === target ? [...keep, alias] : keep
        if (aliases.join("\n") !== image.meta.aliases.join("\n")) {
          await withMeta(image, { ...image.meta, aliases }, signal)
        }
      }
      return old
    },
    async template(alias, signal) {
      const found = await byAlias(alias, signal)
      if (found === undefined)
        throw new Error(`no template is named "${alias}" in the pool "${options.pool}"`)
      return found.vmid
    },
    async release(template, signal) {
      const found = (await inventory.images(signal)).find((image) => image.vmid === template)
      if (found !== undefined) await removeIfUnused(found, signal)
    },
  }
}
