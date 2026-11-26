import { type StoredPlacement, serializePlacement } from "./placement"
import type { LegacySocket } from "./placement-migration"
import { readStoredPlacement } from "./placement-migration"

export interface StoreFiles {
  read(path: string): Promise<string | undefined>
  write(path: string, content: string, mode: number): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
}

export type PlacementReading =
  | { readonly kind: "none" }
  | { readonly kind: "placed"; readonly placement: StoredPlacement }
  | { readonly kind: "migration-required"; readonly from: LegacySocket }

export interface PlacementStore {
  read(): Promise<PlacementReading>
  write(placement: StoredPlacement): Promise<void>
  clear(): Promise<void>
}

export const PLACEMENT_FILE = "endpoint.json"
export const LEGACY_PLACEMENT_FILE = "endpoint.v2.json"

export function filePlacementStore(
  dir: string,
  files: StoreFiles,
  log: (message: string) => void,
): PlacementStore {
  const path = `${dir}/${PLACEMENT_FILE}`
  const legacy = `${dir}/${LEGACY_PLACEMENT_FILE}`

  async function isVersionTwo(text: string): Promise<boolean> {
    try {
      return readStoredPlacement(text, path).kind !== "current"
    } catch {
      return false
    }
  }

  async function keepLegacy(): Promise<void> {
    const text = await files.read(path)
    if (text !== undefined && (await isVersionTwo(text))) await files.rename(path, legacy)
  }

  async function write(placement: StoredPlacement): Promise<void> {
    await keepLegacy()
    await files.write(path, serializePlacement(placement), 0o600)
  }

  return {
    async read() {
      const text = await files.read(path)
      if (text === undefined) return { kind: "none" }
      const reading = readStoredPlacement(text, path)
      switch (reading.kind) {
        case "current":
          return { kind: "placed", placement: reading.placement }
        case "migrated":
          await write(reading.placement)
          log(`moved ${path} to version 3; the earlier file is ${legacy}`)
          return { kind: "placed", placement: reading.placement }
        case "legacy-socket":
          return { kind: "migration-required", from: reading.from }
      }
    },
    write,
    async clear() {
      await keepLegacy()
      await files.remove(path)
    },
  }
}
