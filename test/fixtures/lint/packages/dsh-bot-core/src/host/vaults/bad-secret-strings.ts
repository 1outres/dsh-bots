declare const secret: { use<T>(work: (bytes: Uint8Array) => T): Promise<T> }
declare function send(bytes: Uint8Array): void
declare function leakAll(bytes: Uint8Array): string
declare const helpers: { leak(bytes: Uint8Array): string }

export async function leak() {
  await secret.use((bytes) => new TextDecoder().decode(bytes)) // rule: 61
  await secret.use((bytes) => bytes.toString()) // rule: 61
  await secret.use((bytes) => String(bytes)) // rule: 61
  await secret.use((bytes) => JSON.stringify(bytes)) // rule: 61
  await secret.use((bytes) => String.fromCharCode(...bytes)) // rule: 61
  await secret.use((bytes) => `${bytes}`) // rule: 61
  await secret.use((bytes) => Array.from(bytes)) // rule: 61
  await secret.use((bytes) => bytes.join(",")) // rule: 61
  await secret.use((bytes) => Buffer.from(bytes)) // rule: 61
  await secret.use((bytes) => bytes.slice()) // rule: 61
  await secret.use((bytes) => bytes.subarray(1)) // rule: 61
  await secret.use(leakAll) // rule: 61
  await secret.use(helpers.leak) // rule: 61
  await secret.use((bytes) => send(new Uint8Array(bytes)))
}
