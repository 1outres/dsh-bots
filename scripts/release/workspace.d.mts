export interface WorkspaceManifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export const SCOPE: string
export function workspaceManifests(root: string): { path: string; manifest: WorkspaceManifest }[]
