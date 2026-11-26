import type {
  VaultFieldKind,
  VaultProviderStatus,
  VaultRevealKind,
  VaultSecretKind,
  VaultSetupField,
  VaultSite,
} from "./shared/vaults"

export type * from "./shared/vaults"

const INSPECT = Symbol.for("nodejs.util.inspect.custom")
const REDACTED = "[secret]"

export class SecretBytes {
  #bytes: Uint8Array | undefined
  readonly #length: number

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.#length = bytes.byteLength
  }

  static from(bytes: Uint8Array): SecretBytes {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("a secret is a Uint8Array")
    const own = new Uint8Array(bytes.byteLength)
    own.set(bytes)
    bytes.fill(0)
    return new SecretBytes(own)
  }

  get length(): number {
    return this.#length
  }

  get spent(): boolean {
    return this.#bytes === undefined
  }

  async use<T>(work: (bytes: Uint8Array) => Promise<T> | T): Promise<T> {
    const bytes = this.#bytes
    if (bytes === undefined) throw new Error("this secret was already used")
    this.#bytes = undefined
    try {
      return await work(bytes)
    } finally {
      bytes.fill(0)
    }
  }

  wipe(): void {
    this.#bytes?.fill(0)
    this.#bytes = undefined
  }

  toString(): string {
    return REDACTED
  }

  toJSON(): string {
    return REDACTED
  }

  [INSPECT](): string {
    return REDACTED
  }
}

export interface BotVaultProvider {
  readonly id: string
  readonly name: string
  readonly guide?: string
  readonly development?: boolean
  readonly setup: readonly VaultSetupField[]
  readonly kinds: readonly VaultSecretKind[]
  readonly status?: VaultProviderStatusSource
  open(setup: VaultSetup, signal: AbortSignal): Promise<VaultSession>
}

export interface VaultProviderStatusSource {
  read(): VaultProviderStatus
  subscribe(listener: () => void): () => void
}

export interface VaultSetup {
  readonly text: Readonly<Record<string, string>>
  readonly secrets: Readonly<Record<string, SecretBytes>>
}

export interface VaultSession {
  identify(signal: AbortSignal): Promise<{ readonly subject: string; readonly label: string }>
  listItems(signal: AbortSignal): Promise<readonly VaultItemSummary[]>
  item(ref: VaultItemRef, signal: AbortSignal): Promise<VaultItemSummary | undefined>
  reveal(ref: VaultFieldRef, signal: AbortSignal): Promise<SecretBytes>
  passkey?(ref: VaultFieldRef, signal: AbortSignal): Promise<VaultPasskey>
  close(): Promise<void>
}

export interface VaultItemRef {
  readonly vaultId: string
  readonly itemId: string
}

export interface VaultFieldRef extends VaultItemRef {
  readonly fieldId: string
  readonly kind: VaultSecretKind
}

export interface VaultItemField {
  readonly id: string
  readonly kind: VaultFieldKind
  readonly label: string
}

export interface VaultItemSummary extends VaultItemRef {
  readonly vaultName: string
  readonly title: string
  readonly websites: readonly string[]
  readonly username?: string
  readonly fields: readonly VaultItemField[]
  readonly updatedAt?: number
}

export interface VaultPasskey {
  readonly rpId: string
  readonly credentialId: Uint8Array
  readonly userHandle?: Uint8Array
  readonly signCount: number
  readonly privateKey: SecretBytes
}

export interface BotCredential {
  readonly handle: string
  readonly label: string
  readonly username?: string
  readonly sites: readonly VaultSite[]
  readonly kinds: readonly VaultFieldKind[]
  readonly desktop: boolean
}

export type CredentialTarget = BrowserCredentialTarget | DesktopCredentialTarget

export interface BrowserCredentialTarget {
  readonly kind: "browser"
  readonly origin: string
}

export interface DesktopCredentialTarget {
  readonly kind: "desktop"
  readonly application: string
}

export interface BotVaultAccess {
  describe(handle: string): Promise<BotCredential>
  reveal(handle: string, field: VaultRevealKind, target: CredentialTarget): Promise<SecretBytes>
  passkey(handle: string, target: BrowserCredentialTarget): Promise<VaultPasskey>
}

export interface VaultKit {
  secret(bytes: Uint8Array): SecretBytes
  base64(bytes: Uint8Array): Uint8Array
  base64Url(bytes: Uint8Array): Uint8Array
  jsonString(bytes: Uint8Array): Uint8Array
  concat(parts: readonly Uint8Array[]): Uint8Array
  wipe(...parts: readonly Uint8Array[]): void
}
