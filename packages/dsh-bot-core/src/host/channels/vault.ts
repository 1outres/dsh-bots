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

export interface SharedSecretVault {
  read(channelId: string): Promise<Readonly<Record<string, string>>>
  write(channelId: string, secrets: Readonly<Record<string, string>>): Promise<void>
}

export function vaultKey(botId: string, channelId: string): string {
  try {
    return secretRecordKey(`channel-${channelId}-${botId}`)
  } catch {
    throw new Error(`no credential key can name channel "${channelId}" of bot "${botId}"`)
  }
}

export function sharedVaultKey(channelId: string): string {
  try {
    return secretRecordKey(`shared-channel-${channelId}`)
  } catch {
    throw new Error(`no credential key can name the shared settings of channel "${channelId}"`)
  }
}

export function createSecretVault(records: CredentialRecords): SecretVault {
  return {
    read: (botId, channelId) => readSecrets(records, vaultKey(botId, channelId)),
    write: (botId, channelId, secrets) =>
      writeSecrets(records, vaultKey(botId, channelId), secrets),
  }
}

export function createSharedSecretVault(records: CredentialRecords): SharedSecretVault {
  return {
    read: (channelId) => readSecrets(records, sharedVaultKey(channelId)),
    write: (channelId, secrets) => writeSecrets(records, sharedVaultKey(channelId), secrets),
  }
}
