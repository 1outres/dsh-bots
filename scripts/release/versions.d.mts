import type { ReleaseEnv } from "./release-env.mjs"
import type { WorkspaceManifest } from "./workspace.mjs"

export function versionProblems(
  tag: string,
  releaseEnv: ReleaseEnv,
  manifests: { path: string; manifest: WorkspaceManifest }[],
): string[]
