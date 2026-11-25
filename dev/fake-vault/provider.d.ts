import type { BotVaultProvider, SecretBytes } from "@1outres/dsh-bot-core"

export declare const FAKE_VAULT_ID: "fake-vault"

export declare function fakeVaultProvider(options: {
  readonly secret: (bytes: Uint8Array) => SecretBytes
  readonly passkeys?: string
  readonly now?: () => number
}): BotVaultProvider
