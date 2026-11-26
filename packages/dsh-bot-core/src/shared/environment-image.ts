/**
 * The base image of the bot environment (docs/specs/incus-endpoint.md §5.5):
 * what the settings screen shows of it and how it starts or stops an import.
 * The environment implements {@link BotEnvironmentImageHost}; messages and
 * fixes are English.
 */

/** The published image the environment imports (infra/release.env). */
export interface BotEnvironmentImageRelease {
  readonly tag: string
  readonly manifestSha256: string
  /** Where manifest.txt and the parts are downloaded from. */
  readonly baseUrl: string
}

/** The unified image tarball the release's manifest names. */
export interface BotEnvironmentImageFile {
  readonly name: string
  readonly bytes: number
  /** Its sha256, which is also its Incus fingerprint. */
  readonly fingerprint: string
}

export const IMAGE_IMPORT_STEPS = ["manifest", "download", "upload", "alias"] as const

export type ImageImportStep = (typeof IMAGE_IMPORT_STEPS)[number]

/**
 * Bytes of the step: for `download`, the parts checked or downloaded so far
 * out of the whole image; for `upload`, the bytes sent to Incus. `manifest`
 * and `alias` have none (0 of 0).
 */
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
  | "incus"
  | "fingerprint-mismatch"
  | "alias-missing"
  | "files"
  | "cancelled"

export interface ImageProblem {
  readonly code: ImageProblemCode
  readonly message: string
  readonly fix: string
}

/**
 * - `unchecked`: not looked at since start;
 * - `ready`: the alias points at the release's image (or, unmanaged, exists);
 * - `missing`: the alias is absent, or points at another image (`current`);
 * - `importing`: one import runs, at `progress`;
 * - `failed`: the latest check or import stopped with `problem`.
 */
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
  /** The image alias bot VMs start from. */
  readonly alias: string
  /** Absent while no VM host is decided. */
  readonly project?: string
  /**
   * Whether the environment imports the release's image itself. When not, the
   * alias is used as it is (an image built locally): there is no release and
   * no import, only `ready` or `missing`.
   */
  readonly managed: boolean
  readonly release?: BotEnvironmentImageRelease
  /** Known once the release's manifest was read and verified. */
  readonly image?: BotEnvironmentImageFile
  readonly status: BotEnvironmentImageStatus
}

/** The environment's side; the settings screen's Remote wraps it. */
export interface BotEnvironmentImageHost {
  view(): BotEnvironmentImageView
  /** Called with every new view. */
  subscribe(listener: (view: BotEnvironmentImageView) => void): () => void
  /** Look at the alias again (reading the release's manifest when it is not kept yet). */
  refresh(signal?: AbortSignal): Promise<BotEnvironmentImageView>
  /**
   * Start importing, or join the import that runs: there is at most one.
   * @throws when the image is not managed.
   */
  start(): BotEnvironmentImageView
  /** Stop the running import; what was downloaded stays and the next import continues it. */
  cancel(): BotEnvironmentImageView
}
