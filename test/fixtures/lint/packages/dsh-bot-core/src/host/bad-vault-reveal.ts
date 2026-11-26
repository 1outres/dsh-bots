declare const session: {
  reveal(ref: unknown, signal: AbortSignal): Promise<unknown>
  passkey(ref: unknown, signal: AbortSignal): Promise<unknown>
}
declare const signal: AbortSignal

export async function take(ref: unknown) {
  await session.reveal(ref, signal)
  await session.passkey(ref, signal)
  const bound = session.reveal.bind(session)
  const { reveal } = session
  const { passkey: read } = session
  return [bound, reveal, read]
}
