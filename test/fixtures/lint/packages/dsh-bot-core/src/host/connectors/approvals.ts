declare const deps: { broker: { recordDecision(request: unknown): Promise<unknown> } }

export async function decide(request: unknown) {
  await deps.broker.recordDecision(request)
}
