import type { Server } from "node:http"

export interface FakeAccount {
  readonly sub: string
  readonly email: string
  readonly name: string
  readonly messages: Map<
    string,
    { readonly id: string; readonly threadId: string; labelIds: string[] }
  >
}

export interface FakeEvent {
  readonly id: string
  readonly summary?: string
}

export interface FakeGoogle {
  readonly client: { readonly id: string; readonly secret: string }
  readonly server: Server
  readonly requests: readonly {
    readonly method: string
    readonly path: string
    readonly query: string
  }[]
  readonly accounts: Map<string, FakeAccount>
  deliver(
    email: string,
    message: {
      readonly from: string
      readonly subject: string
      readonly text: string
      readonly to?: string
    },
  ): { readonly id: string; readonly threadId: string }
  listen(port?: number, host?: string): Promise<string>
  close(): Promise<void>
  sent(
    email: string,
  ): readonly { readonly id: string; readonly threadId: string; readonly raw: string }[]
  insertEvent(email: string, body: Record<string, unknown>, organizer: string): FakeEvent
  expireHistory(email: string): void
  changePassword(email: string): void
  expireAccessTokens(): void
}

export function createFakeGoogle(options?: {
  readonly clientId?: string
  readonly clientSecret?: string
  readonly accounts?: readonly {
    readonly sub: string
    readonly email: string
    readonly name: string
  }[]
  readonly accessTokenSeconds?: number
}): FakeGoogle
