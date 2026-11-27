export interface BotEnvironmentImageRelease {
  readonly tag: string
  readonly manifestSha256: string
  readonly baseUrl: string
}

export interface BotEnvironmentImageFile {
  readonly name: string
  readonly bytes: number
  readonly fingerprint: string
}

export const IMAGE_IMPORT_STEPS = ["manifest", "download", "upload", "alias"] as const

export type ImageImportStep = (typeof IMAGE_IMPORT_STEPS)[number]

export interface ImageImportProgress {
  readonly step: ImageImportStep
  readonly doneBytes: number
  readonly totalBytes: number
}

export type ImageProblemCode =
  | "host-unset"
  | "release-unset"
  | "manifest-unreachable"
  | "manifest-mismatch"
  | "manifest-invalid"
  | "manifest-dsh-version"
  | "disk-space"
  | "part-unreachable"
  | "part-mismatch"
  | "image-mismatch"
  | "vm-host"
  | "fingerprint-mismatch"
  | "alias-missing"
  | "files"
  | "cancelled"

export interface ImageProblem {
  readonly code: ImageProblemCode
  readonly message: string
  readonly fix: string
}

export type BotEnvironmentImageStatus =
  | { readonly kind: "unchecked" }
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly fingerprint: string }
  | { readonly kind: "missing"; readonly current?: string }
  | {
      readonly kind: "importing"
      readonly progress: ImageImportProgress
      readonly since: number
    }
  | {
      readonly kind: "failed"
      readonly step: ImageImportStep | "check"
      readonly problem: ImageProblem
      readonly at: number
    }

export interface BotEnvironmentImageView {
  readonly alias: string
  readonly place?: string
  readonly managed: boolean
  readonly release?: BotEnvironmentImageRelease
  readonly image?: BotEnvironmentImageFile
  readonly status: BotEnvironmentImageStatus
}

export interface BotEnvironmentImageHost {
  view(): BotEnvironmentImageView
  subscribe(listener: (view: BotEnvironmentImageView) => void): () => void
  refresh(signal?: AbortSignal): Promise<BotEnvironmentImageView>
  start(): BotEnvironmentImageView
  cancel(): BotEnvironmentImageView
}
