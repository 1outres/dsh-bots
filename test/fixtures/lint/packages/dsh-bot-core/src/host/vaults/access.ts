declare const session: { reveal(ref: unknown, signal: AbortSignal): Promise<unknown> }
declare const signal: AbortSignal

export const take = (ref: unknown) => session.reveal(ref, signal)
