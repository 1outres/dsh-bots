import type { WorkspaceManifest } from "./workspace.mjs"

export interface RegistryState {
  name: string
  version: string
  served: boolean
}

export interface PublishReport {
  lines: string[]
  advice: string[]
}

export function registryStates(
  manifests: { path: string; manifest: WorkspaceManifest }[],
  fetchPackument: (name: string) => Promise<{ versions?: Record<string, unknown> } | null>,
): Promise<RegistryState[]>
export function publishReport(states: RegistryState[]): PublishReport
