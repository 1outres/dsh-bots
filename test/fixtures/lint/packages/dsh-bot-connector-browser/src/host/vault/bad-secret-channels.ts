declare const secret: { use<T>(work: (bytes: Uint8Array) => T): Promise<T> }
declare const environment: {
  exec(command: unknown): Promise<unknown>
  spawn(command: unknown): Promise<unknown>
  writeFile(path: string, data: Uint8Array): Promise<void>
}
declare const stdin: { write(data: Uint8Array): Promise<void> }

export async function leak() {
  await secret.use((bytes) => environment.exec({ argv: ["type", bytes] }))
  await secret.use((bytes) => environment.spawn({ argv: ["x"], stdin: bytes }))
  await secret.use((bytes) => environment.writeFile("/tmp/x", bytes))
  await secret.use((bytes) => console.log(bytes))
  await secret.use(() => process.env)
  await secret.use((bytes) => stdin.write(bytes))
}
