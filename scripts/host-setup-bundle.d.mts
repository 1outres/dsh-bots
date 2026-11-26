export interface HostSetupFile {
  readonly path: string
  readonly source: string
  readonly mode: number
}

export interface HostSetupManifestEntry {
  readonly path: string
  readonly mode: number
  readonly sha256: string
}

export interface HostSetupManifest {
  readonly version: 1
  readonly sha256: string
  readonly files: readonly HostSetupManifestEntry[]
}

export const HOST_SETUP_BUNDLE_DIR: string
export const HOST_SETUP_FILES: readonly HostSetupFile[]
export function bundleDigestText(entries: readonly HostSetupManifestEntry[]): string
export function hostSetupManifest(root: string): Promise<HostSetupManifest>
export function writeHostSetupBundle(root: string, outDir?: string): Promise<HostSetupManifest>
