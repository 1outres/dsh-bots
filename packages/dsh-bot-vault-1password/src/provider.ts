import type { BotVaultProvider, SecretBytes, VaultSetup } from "@1outres/dsh-bot-core"
import type { OpInstaller } from "./cli/install"
import { tokenProblem } from "./op/environment"
import { createOpHome } from "./op/home"
import { createOnePasswordSession } from "./session"

export const ONE_PASSWORD_PROVIDER_ID = "onepassword"
export const TOKEN_KEY = "token"
export const GUIDE_URL = "https://github.com/1outres/dsh-bots/blob/main/docs/1password.md"

export interface OnePasswordProviderDeps {
  readonly installer: OpInstaller
  secret(bytes: Uint8Array): SecretBytes
  readonly temporaryDirectory: string
  now(): number
}

const wipeSetup = (setup: VaultSetup) => {
  for (const secret of Object.values(setup.secrets)) secret.wipe()
}

export function onePasswordProvider(deps: OnePasswordProviderDeps): BotVaultProvider {
  return {
    id: ONE_PASSWORD_PROVIDER_ID,
    name: "1Password",
    guide: GUIDE_URL,
    setup: [
      {
        key: TOKEN_KEY,
        label: { en: "Service account token", ja: "サービスアカウントのトークン" },
        kind: "secret",
        required: true,
        help: {
          en: "Passkeys cannot be used (1Password never hands out their keys). The token (ops_…) of a service account that may only read the bots' vault.",
          ja: "パスキーは使えません（1Password は鍵を出さないため）。ボット用の Vault の読み取りだけを許したサービスアカウントのトークン（ops_…）。",
        },
      },
    ],
    kinds: ["password", "otp"],
    status: deps.installer.status,
    async open(setup, signal) {
      const secret = setup.secrets[TOKEN_KEY]
      if (secret === undefined) {
        wipeSetup(setup)
        throw new Error("the service account token is missing")
      }
      let token: Uint8Array
      try {
        token = await secret.use((bytes) => Uint8Array.from(bytes))
      } finally {
        wipeSetup(setup)
      }
      try {
        const problem = tokenProblem(token)
        if (problem !== undefined) throw new Error(problem)
        const binary = await deps.installer.binary(signal)
        const home = await createOpHome(deps.temporaryDirectory)
        return createOnePasswordSession({ binary, token, home, secret: deps.secret, now: deps.now })
      } catch (error) {
        token.fill(0)
        throw error
      }
    },
  }
}
