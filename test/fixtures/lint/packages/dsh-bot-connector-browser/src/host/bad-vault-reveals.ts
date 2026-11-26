declare const run: {
  vault?: {
    reveal(handle: string, field: string, target: unknown): Promise<unknown>
    passkey(handle: string, target: unknown): Promise<unknown>
  }
}

export const fill = () => run.vault?.reveal("cred-1", "password", { kind: "browser", origin: "x" })
export const offer = () => run.vault?.passkey("cred-1", { kind: "browser", origin: "x" })
