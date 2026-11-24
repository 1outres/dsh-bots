/**
 * Secret values of bots' channel settings, kept as one DSH credential record
 * per bot and channel (`bot-core/channel-<channel>-<bot>`). Nothing here
 * returns a secret to the browser.
 */
import {
  type CredentialRecords,
  readSecrets,
  secretRecordKey,
  writeSecrets,
} from "../secret-record"

export type { CredentialRecords, SecretPayload } from "../secret-record"

export interface SecretVault {
  /** The stored secrets, by field key ({} when none). @throws when the record is not bot-core's. */
  read(botId: string, channelId: string): Promise<Readonly<Record<string, string>>>
  /** Replace the stored secrets; an empty set removes the record. */
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
