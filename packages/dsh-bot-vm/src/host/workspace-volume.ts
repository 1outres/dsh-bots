import type { WorkspaceRecord } from "./backend/contract"

export const volumeNameOf = (instance: string) => `${instance}-workspace`

const GIB = 1024 ** 3

export type VolumePlan =
  | { readonly kind: "create" }
  | { readonly kind: "keep" }
  | { readonly kind: "larger"; readonly sizeText: string }
  | { readonly kind: "grow"; readonly sizeGiB: number }

export function ownedVolume(
  volume: WorkspaceRecord,
  owned: (volume: WorkspaceRecord) => boolean,
): WorkspaceRecord & { readonly sizeBytes: number } {
  if (!owned(volume)) {
    throw new Error(
      `the workspace volume "${volume.name}" exists but was not created by this installation for this bot; rename or delete it`,
    )
  }
  if (!volume.block) throw new Error(`the workspace volume "${volume.name}" is not a block volume`)
  const { sizeBytes } = volume
  if (sizeBytes === undefined)
    throw new Error(`cannot read the size of the workspace volume "${volume.name}"`)
  return { ...volume, sizeBytes }
}

export const wholeGiBOf = (volume: { readonly sizeBytes: number }) =>
  Math.floor(volume.sizeBytes / GIB)

export function volumePlan(
  volume: WorkspaceRecord | undefined,
  wantedGiB: number,
  owned: (volume: WorkspaceRecord) => boolean,
): VolumePlan {
  if (volume === undefined) return { kind: "create" }
  const { sizeBytes, sizeText } = ownedVolume(volume, owned)
  const wanted = wantedGiB * GIB
  if (wanted < sizeBytes) return { kind: "larger", sizeText }
  return wanted === sizeBytes ? { kind: "keep" } : { kind: "grow", sizeGiB: wantedGiB }
}
