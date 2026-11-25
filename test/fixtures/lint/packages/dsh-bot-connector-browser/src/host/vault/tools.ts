declare const vault: {
  reveal(handle: string, field: string, target: unknown): Promise<unknown>
  passkey(handle: string, target: unknown): Promise<unknown>
}

export const fill = (origin: string) => vault.reveal("cred-1", "password", { kind: "browser", origin })
export const offer = (origin: string) => vault.passkey("cred-1", { kind: "browser", origin })
