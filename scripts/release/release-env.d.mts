export type ReleaseEnv = Record<
  "DSH_BOTS_VERSION" | "DSH_VERSION" | "IMAGE_TAG" | "IMAGE_MANIFEST_SHA256",
  string
>

export const RELEASE_ENV_PATH: string
export const RELEASE_ENV_KEYS: readonly string[]
export function parseReleaseEnv(text: string): ReleaseEnv
export function readReleaseEnv(root: string): ReleaseEnv
