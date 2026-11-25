// Verification only (dev/, outside packages/: never built, published or bundled). See README.md.
import { vaultProbeConnector } from "./connector.js"
import { fakeVaultProvider } from "./provider.js"

export const name = "fake-vault"
export const inject = ["bot"]

export function apply(ctx) {
  const bot = ctx.get("bot")
  const provider = fakeVaultProvider({
    secret: bot.vaultKit().secret,
    passkeys: process.env.FAKE_VAULT_PASSKEYS,
  })
  ctx.effect(() => bot.registerVaultProvider(provider), "fake-vault: provider")
  ctx.effect(() => bot.registerConnector(vaultProbeConnector), "fake-vault: vault probe connector")
}
