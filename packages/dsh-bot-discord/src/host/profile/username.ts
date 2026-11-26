export const USERNAME_MIN_LENGTH = 2
export const USERNAME_MAX_LENGTH = 32
export const USERNAME_FORBIDDEN_PARTS = ["@", "#", ":", "```", "discord"] as const
export const USERNAME_RESERVED = ["everyone", "here"] as const

export type UsernameCheck =
  | { readonly ok: true; readonly username: string }
  | { readonly ok: false; readonly reason: "length" }
  | { readonly ok: false; readonly reason: "part"; readonly part: string }
  | { readonly ok: false; readonly reason: "reserved" }

export function discordUsernameOf(name: string): UsernameCheck {
  const username = name.trim().replace(/\s+/gu, " ")
  const length = [...username].length
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    return { ok: false, reason: "length" }
  }
  const lower = username.toLowerCase()
  const part = USERNAME_FORBIDDEN_PARTS.find((forbidden) => lower.includes(forbidden))
  if (part !== undefined) return { ok: false, reason: "part", part }
  if ((USERNAME_RESERVED as readonly string[]).includes(lower)) {
    return { ok: false, reason: "reserved" }
  }
  return { ok: true, username }
}
