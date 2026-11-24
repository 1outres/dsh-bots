/**
 * bot-core's secrets in DSH's credential store: one `grant` record per owner
 * (a bot's channel, a web backend) whose payload only bot-core reads.
 */

/** The slice of DSH's `credentials` service bot-core uses (dsh-credentials `CredentialProvider`). */
export interface CredentialRecords {
  readRecord(
    key: string,
  ): Promise<{ readonly kind: string; readonly payload?: unknown } | undefined>
  modifyRecord(
    key: string,
    mutate: () => Promise<{ kind: "grant"; payload: SecretPayload } | undefined>,
  ): Promise<unknown>
  deleteRecord(key: string): Promise<unknown>
}

export interface SecretPayload {
  readonly version: 1
  readonly secrets: Readonly<Record<string, string>>
}

/** The credential owner scope: bot-core's registered plugin name. */
export const SECRET_SCOPE = "bot-core"

const SEGMENT = /^[a-z][a-z0-9-]*$/

/** `bot-core/<id>`. @throws when `id` cannot be one key segment. */
export function secretRecordKey(id: string): string {
  if (!SEGMENT.test(id)) throw new Error(`no credential key can be named "${id}"`)
  return `${SECRET_SCOPE}/${id}`
}

function secretsOf(
  key: string,
  record: { readonly kind: string; readonly payload?: unknown },
): Readonly<Record<string, string>> {
  const payload = record.payload as Partial<SecretPayload> | undefined
  const secrets = payload?.secrets
  if (
    record.kind !== "grant" ||
    payload?.version !== 1 ||
    typeof secrets !== "object" ||
    secrets === null ||
    Object.values(secrets).some((value) => typeof value !== "string")
  ) {
    throw new Error(`the credential record "${key}" is not one bot-core wrote`)
  }
  return secrets
}

/** The secrets stored under `key` ({} when none). @throws when the record is not bot-core's. */
export async function readSecrets(
  records: CredentialRecords,
  key: string,
): Promise<Readonly<Record<string, string>>> {
  const record = await records.readRecord(key)
  return record === undefined ? {} : { ...secretsOf(key, record) }
}

/** Replace the secrets stored under `key`; an empty set removes the record. */
export async function writeSecrets(
  records: CredentialRecords,
  key: string,
  secrets: Readonly<Record<string, string>>,
): Promise<void> {
  if (Object.keys(secrets).length === 0) {
    await records.deleteRecord(key)
    return
  }
  await records.modifyRecord(key, async () => ({
    kind: "grant",
    payload: { version: 1, secrets: { ...secrets } },
  }))
}
