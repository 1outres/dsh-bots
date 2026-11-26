export interface GoogleEndpoints {
  readonly authorization: string
  readonly token: string
  readonly revocation: string
  readonly userinfo: string
  readonly gmailRoot: string
  readonly calendarRoot: string
  readonly development: boolean
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revocation: "https://oauth2.googleapis.com/revoke",
  userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
  gmailRoot: "https://gmail.googleapis.com/",
  calendarRoot: "https://www.googleapis.com/",
  development: false,
}

export function developmentEndpoints(origin: string): GoogleEndpoints {
  const url = new URL(origin)
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== origin.replace(/\/$/, "")
  ) {
    throw new Error("development.googleOrigin must be an http(s) origin without a path")
  }
  const base = url.origin
  return {
    authorization: `${base}/o/oauth2/v2/auth`,
    token: `${base}/token`,
    revocation: `${base}/revoke`,
    userinfo: `${base}/v1/userinfo`,
    gmailRoot: `${base}/`,
    calendarRoot: `${base}/`,
    development: true,
  }
}
