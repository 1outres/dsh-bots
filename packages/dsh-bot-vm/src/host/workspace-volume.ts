import type { WorkspaceRecord } from "./backend/contract"

export const volumeNameOf = (instance: string) => `${instance}-workspace`

const GIB = 1024 ** 3

export type VolumePlan =
  | { readonly kind: "create" }
  | { readonly kind: "keep" }
  | { readonly kind: "grow"; readonly sizeGiB: number }

export function volumePlan(
  volume: WorkspaceRecord | undefined,
  wantedGiB: number,
  owned: (volume: WorkspaceRecord) => boolean,
): VolumePlan {
  if (volume === undefined) return { kind: "create" }
  if (!owned(volume)) {
    throw new Error(
      `the workspace volume "${volume.name}" exists but was not created by this installation for this bot; rename or delete it`,
    )
  }
  if (!volume.block) throw new Error(`the workspace volume "${volume.name}" is not a block volume`)
  if (volume.sizeBytes === undefined)
    throw new Error(`cannot read the size of the workspace volume "${volume.name}"`)
  const wanted = wantedGiB * GIB
  if (wanted < volume.sizeBytes) {
    throw new Error(
      `the workspace volume "${volume.name}" is ${volume.sizeText}; it cannot shrink to ${wantedGiB}GiB`,
    )
  }
  return wanted === volume.sizeBytes ? { kind: "keep" } : { kind: "grow", sizeGiB: wantedGiB }
}
