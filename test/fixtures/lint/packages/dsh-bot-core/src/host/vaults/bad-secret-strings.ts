declare const secret: { use<T>(work: (bytes: Uint8Array) => T): Promise<T> }
declare function send(bytes: Uint8Array): void
declare function leakAll(bytes: Uint8Array): string
declare const helpers: { leak(bytes: Uint8Array): string }

export async function leak() {
  await secret.use((bytes) => new TextDecoder().decode(bytes))
  await secret.use((bytes) => bytes.toString())
  await secret.use((bytes) => String(bytes))
  await secret.use((bytes) => JSON.stringify(bytes))
  await secret.use((bytes) => String.fromCharCode(...bytes))
  await secret.use((bytes) => `${bytes}`)
  await secret.use((bytes) => Array.from(bytes))
  await secret.use((bytes) => bytes.join(","))
  await secret.use((bytes) => Buffer.from(bytes))
  await secret.use((bytes) => bytes.slice())
  await secret.use((bytes) => bytes.subarray(1))
  await secret.use(leakAll)
  await secret.use(helpers.leak)
  await secret.use((bytes) => send(new Uint8Array(bytes)))
}
