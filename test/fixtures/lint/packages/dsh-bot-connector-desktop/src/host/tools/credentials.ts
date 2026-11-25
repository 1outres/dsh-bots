declare const vault: {
  reveal(handle: string, field: string, target: unknown): Promise<unknown>
}

export async function take() {
  await vault.reveal("cred-1", "password", { kind: "desktop", application: "zenity" })
}
