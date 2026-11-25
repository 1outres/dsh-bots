/** op's JSON as the provider meets it, with values that must never surface. */

export const PASSWORD = "Hunter2-correct-horse"
export const OLD_PASSWORD = "Old-password-in-history"
export const OTP_SEED = "otpauth://totp/Example:bot?secret=JBSWY3DPEHPK3PXP&issuer=Example"
export const OTP_CODE = "492039"
export const NOTE = "Recovery codes: 1111-2222-3333"
export const OTHER_SECRET = "Concealed-api-key-9f8e7d"

/** Every value the provider must never decode. */
export const SECRETS = [PASSWORD, OLD_PASSWORD, OTP_SEED, OTP_CODE, NOTE, OTHER_SECRET]

export const VAULT_ID = "vaultid0000000000000000001"
export const ITEM_ID = "itemid00000000000000000001"
export const OTP_FIELD_ID = "TOTP_otpfield00000000000001"

export function loginItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ITEM_ID,
    title: "Example \u00e9 login",
    version: 4,
    vault: { id: VAULT_ID, name: "Bots" },
    category: "LOGIN",
    last_edited_by: "SERVICEACCOUNT",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    additional_information: "bot@example.com",
    urls: [
      { label: "website", primary: true, href: "https://example.com/login" },
      { href: "https://accounts.example.com" },
    ],
    sections: [{ id: "add more" }, { id: "s1", label: "Security" }],
    fields: [
      {
        id: "username",
        type: "STRING",
        purpose: "USERNAME",
        label: "username",
        value: "bot@example.com",
        reference: "op://Bots/Example/username",
      },
      {
        id: "password",
        type: "CONCEALED",
        purpose: "PASSWORD",
        label: "password",
        value: PASSWORD,
        entropy: 120.5,
        reference: "op://Bots/Example/password",
        password_details: { strength: "FANTASTIC", history: [OLD_PASSWORD] },
      },
      {
        id: "notesPlain",
        type: "STRING",
        purpose: "NOTES",
        label: "notesPlain",
        value: NOTE,
        reference: "op://Bots/Example/notesPlain",
      },
      {
        id: "apikey000000000000000000001",
        section: { id: "s1", label: "Security" },
        type: "CONCEALED",
        label: "api key",
        value: OTHER_SECRET,
        reference: "op://Bots/Example/Security/api key",
      },
      {
        id: OTP_FIELD_ID,
        section: { id: "add more" },
        type: "OTP",
        label: "one-time password",
        value: OTP_SEED,
        totp: OTP_CODE,
        reference: "op://Bots/Example/add more/one-time password",
      },
    ],
    ...overrides,
  }
}

export const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
