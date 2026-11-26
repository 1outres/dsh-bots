declare const vault: {
  reveal(handle: string, field: string, target: unknown): Promise<unknown>
  passkey(handle: string, target: unknown): Promise<unknown>
}

export async function take() {
  await vault.reveal("cred-1", "password", { kind: "desktop", application: "zenity" })
  await vault.passkey("cred-1", { kind: "browser", origin: "https://a.test" })
}
