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

/**
 * A secret's bytes, usable once (docs/specs/bot-vaults.md §2, §6). {@link use}
 * hands the bytes to a callback and fills them with zeros when it settles,
 * whether it resolved or threw; a second use throws. Printing, JSON and
 * `util.inspect` show `[secret]`. Never turn the bytes into a JS string.
 */
export class SecretBytes {
  #bytes: Uint8Array | undefined
  readonly #length: number

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.#length = bytes.byteLength
  }

  /**
   * Take the bytes as a secret: they are moved into an array of the secret's
   * own (a Node Buffer may be a view of a shared pool) and the given array is
   * filled with zeros, so the caller has nothing left to wipe.
   */
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

  /** Whether the bytes were used or wiped. */
  get spent(): boolean {
    return this.#bytes === undefined
  }

  /**
   * Run `work` with the bytes, then wipe them.
   * @throws when the secret was already used or wiped.
   */
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

  /** Fill the bytes with zeros without using them; a later use throws. */
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

/**
 * A password manager (1Password, later Bitwarden) bot-core connects
 * accounts of. bot-core keeps the accounts, their setup secrets (in DSH's
 * credential store), the bots' logins and every check; the provider only
 * reads its service.
 *
 * A provider's promises: never turn a value into a JS string, never cache
 * one, never put one in an error message or a log, never write one to a
 * file (a temporary one included).
 */
export interface BotVaultProvider {
  /** Lower-case letters, digits and `-`, starting with a letter. */
  readonly id: string
  /** Shown to people (a product name). */
  readonly name: string
  /** An https page that walks through setting up an account for bots. */
  readonly guide?: string
  /** A verification-only provider (a fake vault), shown as such. */
  readonly development?: boolean
  /** What connecting an account takes. */
  readonly setup: readonly VaultSetupField[]
  /** The secrets it can hand out. */
  readonly kinds: readonly VaultSecretKind[]
  /** Its own state (tooling being fetched…), shown in the settings. */
  readonly status?: VaultProviderStatusSource
  /**
   * Connect one account. The secrets of `setup` are the provider's from
   * here on: it wipes them when the session closes (or when `open` fails).
   */
  open(setup: VaultSetup, signal: AbortSignal): Promise<VaultSession>
}

export interface VaultProviderStatusSource {
  read(): VaultProviderStatus
  subscribe(listener: () => void): () => void
}

/** An account's setup values: secret fields as bytes, the others as text. */
export interface VaultSetup {
  readonly text: Readonly<Record<string, string>>
  readonly secrets: Readonly<Record<string, SecretBytes>>
}

/** One connected account. Every method honours its signal. */
export interface VaultSession {
  /** Who the account is (an account URL), and a name for it. */
  identify(signal: AbortSignal): Promise<{ readonly subject: string; readonly label: string }>
  /** Its items, without values. */
  listItems(signal: AbortSignal): Promise<readonly VaultItemSummary[]>
  /** One item now, without values; undefined when it is gone or out of reach. */
  item(ref: VaultItemRef, signal: AbortSignal): Promise<VaultItemSummary | undefined>
  /** One secret field's value (`password`), or the current one-time code (`otp`). */
  reveal(ref: VaultFieldRef, signal: AbortSignal): Promise<SecretBytes>
  /** Only for a provider whose kinds include `passkey`. */
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
  /** URLs as the provider keeps them; bot-core takes their origins. */
  readonly websites: readonly string[]
  /** Not a secret: the owner sees it; whether the bot does is the login's setting. */
  readonly username?: string
  readonly fields: readonly VaultItemField[]
  readonly updatedAt?: number
}

export interface VaultPasskey {
  readonly rpId: string
  /** Public. */
  readonly credentialId: Uint8Array
  readonly userHandle?: Uint8Array
  readonly signCount: number
  /** PKCS#8 DER. */
  readonly privateKey: SecretBytes
}

/** A login of the bot, as a connector and the bot see it: never a value or a provider id. */
export interface BotCredential {
  /** `cred-…`. */
  readonly handle: string
  readonly label: string
  /** When the owner shows it. */
  readonly username?: string
  readonly sites: readonly VaultSite[]
  /** The fields the bot may use. */
  readonly kinds: readonly VaultFieldKind[]
  /** Whether it may be typed in desktop applications. */
  readonly desktop: boolean
}

/** Where a connector puts a value: the target frame's origin, or the focused application. */
export type CredentialTarget = BrowserCredentialTarget | DesktopCredentialTarget

export interface BrowserCredentialTarget {
  readonly kind: "browser"
  readonly origin: string
}

export interface DesktopCredentialTarget {
  readonly kind: "desktop"
  /** For the record only. */
  readonly application: string
}

/**
 * A connector tool's way to the bot's logins (`BotConnectorRun.vault`, for
 * a tool that declares `vault: true`). Every reveal is checked against the
 * login, recorded and fingerprinted for the leak guard before it is handed
 * over; nothing is cached, so each value is fetched for one entry.
 */
export interface BotVaultAccess {
  /** @throws "not one of this bot's credentials" for any other handle. */
  describe(handle: string): Promise<BotCredential>
  /** @throws with the reason it was refused (never a value). */
  reveal(handle: string, field: VaultRevealKind, target: CredentialTarget): Promise<SecretBytes>
  /** @throws with the reason it was refused. */
  passkey(handle: string, target: BrowserCredentialTarget): Promise<VaultPasskey>
}

/**
 * What a provider or connector package needs to handle a secret without
 * importing bot-core's code (`Bot.vaultKit()`): making a {@link SecretBytes}
 * and the byte-level encodings of vault-bytes.ts.
 */
export interface VaultKit {
  /** Move the bytes into a secret; the given array is filled with zeros. */
  secret(bytes: Uint8Array): SecretBytes
  base64(bytes: Uint8Array): Uint8Array
  base64Url(bytes: Uint8Array): Uint8Array
  /** A JSON string's body (without quotes). */
  jsonString(bytes: Uint8Array): Uint8Array
  concat(parts: readonly Uint8Array[]): Uint8Array
  wipe(...parts: readonly Uint8Array[]): void
}
