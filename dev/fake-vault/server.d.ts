import type { Server } from "node:http"

export declare function createTestSite(options: {
  readonly items: unknown
  readonly passkeys?: () => readonly unknown[]
}): { readonly server: Server; listen(port: number, host: string): Promise<string> }

export declare function readJson(path: string): unknown
