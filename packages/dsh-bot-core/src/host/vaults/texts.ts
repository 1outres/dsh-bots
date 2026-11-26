import type { ListedCredential } from "./access"

export const CREDENTIALS_LIST_TOOL = "credentials_list"

export const CREDENTIALS_LIST_DESCRIPTION =
  "List the logins your owner lets you use: each one's handle, name, username (when shown), the sites it may be filled in, the fields you may use (username, password, otp, passkey) and whether desktop applications may get it. " +
  "Fill them with the connectors' credential tools, which take the handle; you never see a value."

export const VAULT_PROMPT =
  "## Logins\n" +
  "Your owner lets you use some logins (passwords, one-time codes, passkeys) kept in a password manager. " +
  "To sign in, list them with credentials_list and fill them with the connectors' credential tools, which take a login's handle. " +
  "Never ask anyone for a password, never write one anywhere, and never read one back from a page, a file or a screen: you are not meant to see the values, and not seeing them is normal. " +
  "When a tool result shows [withheld: secret of …], a secret was where you looked: do not look for it again, continue in a way that does not read it."

const FIELD_ORDER = ["username", "password", "otp", "passkey"] as const

export function credentialsListAnswer(listed: readonly ListedCredential[]): {
  readonly text: string
  readonly data: unknown
} {
  if (listed.length === 0) {
    return { text: "Your owner has not given you any login.", data: { credentials: [] } }
  }
  const rows = listed.map(({ credential, connectors, state }) => ({
    handle: credential.handle,
    label: credential.label,
    ...(credential.username === undefined ? {} : { username: credential.username }),
    sites: credential.sites.map((site) =>
      site.subdomains ? `${site.origin} (and subdomains)` : site.origin,
    ),
    fields: FIELD_ORDER.filter((kind) => credential.kinds.includes(kind)),
    desktop: credential.desktop,
    connectors,
    ...(state === "available"
      ? {}
      : {
          problem:
            state === "missing"
              ? "its item is gone; tell your owner"
              : "the password manager cannot be reached now",
        }),
  }))
  const text = [
    "Logins you may use (pass the handle to a connector's credential tool):",
    ...rows.map(
      (row) =>
        `- ${row.handle}: ${row.label}${row.username === undefined ? "" : ` (user ${row.username})`}; fields: ${row.fields.join(", ") || "none"}; sites: ${row.sites.join(", ") || "none"}; connectors: ${row.connectors.join(", ") || "none"}${row.desktop ? "; desktop applications too" : ""}${row.problem === undefined ? "" : ` — ${row.problem}`}`,
    ),
  ].join("\n")
  return { text, data: { credentials: rows } }
}
