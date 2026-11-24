declare const entry: {
  tool: {
    execute(args: unknown): Promise<unknown>
    recheck(args: unknown): Promise<unknown>
    snapshot(args: unknown): Promise<unknown>
  }
}
declare const connector: {
  preparation: { prepare(): Promise<void>; unprepare(): Promise<void> }
  attachment: { open(): Promise<unknown> }
}
declare const deps: {
  actions: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
  notices: { put(key: string, value: unknown): Promise<void>; delete(key: string): Promise<unknown> }
}
declare const pending: Map<string, unknown>

export async function bypass(args: unknown) {
  await entry.tool.recheck(args) // rule: 39
  await entry.tool.execute(args) // rule: 39
  await entry.tool.snapshot(args) // rule: 39
  await connector.preparation.prepare() // rule: 43
  await connector.preparation.unprepare() // rule: 43
  await connector.attachment.open() // rule: 43
  await deps.actions.put("a", args) // rule: 40
  await deps.actions.delete("a") // rule: 40
  await deps.notices.put("n", args) // rule: 41
  await deps.notices.delete("n") // rule: 41
  pending.delete("a")
}
