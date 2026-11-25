declare const session: {
  reveal(ref: unknown, signal: AbortSignal): Promise<unknown>
  passkey(ref: unknown, signal: AbortSignal): Promise<unknown>
}
declare const signal: AbortSignal

export async function take(ref: unknown) {
  await session.reveal(ref, signal) // rule: 59
  await session.passkey(ref, signal) // rule: 59
  const bound = session.reveal.bind(session) // rule: 59
  const { reveal } = session // rule: 59
  const { passkey: read } = session // rule: 59
  return [bound, reveal, read]
}
