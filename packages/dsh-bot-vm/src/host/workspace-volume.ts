import type { IncusVolume } from "./incus"
import { GIB, gibText, SIZE_KEY, sizeBytesOf } from "./spec"

export const volumeNameOf = (instance: string) => `${instance}-workspace`

export type VolumePlan =
  | { readonly kind: "create" }
  | { readonly kind: "keep" }
  | { readonly kind: "grow"; readonly size: string }

export function volumePlan(
  volume: IncusVolume | undefined,
  wantedGiB: number,
  owned: (volume: IncusVolume) => boolean,
): VolumePlan {
  if (volume === undefined) return { kind: "create" }
  if (!owned(volume)) {
    throw new Error(
      `the Incus volume "${volume.name}" exists but was not created by this installation for this bot; rename or delete it`,
    )
  }
  if (volume.contentType !== "block")
    throw new Error(`the Incus volume "${volume.name}" is not a block volume`)
  const current = sizeBytesOf(volume.config[SIZE_KEY])
  if (current === undefined)
    throw new Error(`cannot read the size of the Incus volume "${volume.name}"`)
  const wanted = wantedGiB * GIB
  if (wanted < current) {
    throw new Error(
      `the workspace volume "${volume.name}" is ${volume.config[SIZE_KEY]}; it cannot shrink to ${gibText(wantedGiB)}`,
    )
  }
  return wanted === current ? { kind: "keep" } : { kind: "grow", size: gibText(wantedGiB) }
}
