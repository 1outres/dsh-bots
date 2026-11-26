import {
  type CredentialRecords,
  readSecrets,
  secretRecordKey,
  writeSecrets,
} from "../secret-record"

export type { CredentialRecords, SecretPayload } from "../secret-record"

export interface SecretVault {
  read(botId: string, channelId: string): Promise<Readonly<Record<string, string>>>
  write(botId: string, channelId: string, secrets: Readonly<Record<string, string>>): Promise<void>
}

export function vaultKey(botId: string, channelId: string): string {
  try {
    return secretRecordKey(`channel-${channelId}-${botId}`)
  } catch {
    throw new Error(`no credential key can name channel "${channelId}" of bot "${botId}"`)
  }
}

export function createSecretVault(records: CredentialRecords): SecretVault {
  return {
    read: (botId, channelId) => readSecrets(records, vaultKey(botId, channelId)),
    write: (botId, channelId, secrets) =>
      writeSecrets(records, vaultKey(botId, channelId), secrets),
  }
}
