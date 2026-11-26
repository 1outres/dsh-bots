import type { BotConnectorConnection } from "@1outres/dsh-bot-core"
import { calendar_v3 } from "@googleapis/calendar"
import { gmail_v1 } from "@googleapis/gmail"
import { OAuth2Client } from "google-auth-library"
import type { GoogleEndpoints } from "./endpoints"

export type HttpFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
) => Promise<{ readonly status: number; json(): Promise<unknown> }>

export interface GoogleApis {
  readonly gmail: gmail_v1.Gmail
  readonly calendar: calendar_v3.Calendar
  readonly gmailUpload: { readonly rootUrl: string }
}

export class GoogleApiError extends Error {
  override readonly name = "GoogleApiError"
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message)
  }
}

export function googleStatus(error: unknown): number | undefined {
  if (error instanceof GoogleApiError) return error.status
  const status =
    (error as { status?: unknown; response?: { status?: unknown } } | null)?.response?.status ??
    (error as { status?: unknown } | null)?.status
  return typeof status === "number" ? status : undefined
}

function reasonOf(error: unknown): string {
  const data = (
    error as { response?: { data?: { error?: { message?: unknown } | string } } } | null
  )?.response?.data
  const detail = typeof data?.error === "object" ? data.error.message : data?.error
  if (typeof detail === "string" && detail !== "") return detail
  return error instanceof Error ? error.message : String(error)
}

export interface Google {
  as<T>(connection: BotConnectorConnection, work: (apis: GoogleApis) => Promise<T>): Promise<T>
}

export function createGoogle(endpoints: GoogleEndpoints): Google {
  const apis = (token: string): GoogleApis => {
    const auth = new OAuth2Client()
    auth.setCredentials({ access_token: token })
    return {
      gmail: new gmail_v1.Gmail({ auth, rootUrl: endpoints.gmailRoot }),
      calendar: new calendar_v3.Calendar({ auth, rootUrl: endpoints.calendarRoot }),
      gmailUpload: { rootUrl: endpoints.gmailRoot },
    }
  }
  return {
    async as(connection, work) {
      const attempt = async (refresh: boolean) =>
        work(apis(await connection.accessToken({ refresh })))
      try {
        try {
          return await attempt(false)
        } catch (error) {
          if (googleStatus(error) !== 401) throw error
          return await attempt(true)
        }
      } catch (error) {
        if (error instanceof GoogleApiError) throw error
        const status = googleStatus(error)
        throw new GoogleApiError(
          status,
          status === undefined ? reasonOf(error) : `Google answered ${status}: ${reasonOf(error)}`,
        )
      }
    },
  }
}
