declare const broker: { recordDecision(request: unknown): Promise<unknown> }
declare const deps: { broker?: { recordDecision(request: unknown): Promise<unknown> } }

export async function decideAnyway(request: unknown) {
  await broker.recordDecision(request) // rule: 46
  await deps.broker?.recordDecision(request) // rule: 46
}
