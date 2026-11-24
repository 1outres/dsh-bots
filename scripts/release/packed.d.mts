import type { WorkspaceManifest } from "./workspace.mjs"

export function packedManifestProblems(manifest: WorkspaceManifest, version: string): string[]
export function packWorkspace(root: string): WorkspaceManifest[]
export function packedProblems(root: string, version: string): string[]
