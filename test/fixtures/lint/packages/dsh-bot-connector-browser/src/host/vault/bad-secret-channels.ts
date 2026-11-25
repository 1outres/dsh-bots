declare const secret: { use<T>(work: (bytes: Uint8Array) => T): Promise<T> }
declare const environment: {
  exec(command: unknown): Promise<unknown>
  spawn(command: unknown): Promise<unknown>
  writeFile(path: string, data: Uint8Array): Promise<void>
}
declare const stdin: { write(data: Uint8Array): Promise<void> }

export async function leak() {
  await secret.use((bytes) => environment.exec({ argv: ["type", bytes] })) // rule: 64
  await secret.use((bytes) => environment.spawn({ argv: ["x"], stdin: bytes })) // rule: 64
  await secret.use((bytes) => environment.writeFile("/tmp/x", bytes)) // rule: 64
  await secret.use((bytes) => console.log(bytes)) // rule: 64
  await secret.use(() => process.env) // rule: 64
  await secret.use((bytes) => stdin.write(bytes))
}
