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
  await entry.tool.recheck(args)
  await entry.tool.execute(args)
  await entry.tool.snapshot(args)
  await connector.preparation.prepare()
  await connector.preparation.unprepare()
  await connector.attachment.open()
  await deps.actions.put("a", args)
  await deps.actions.delete("a")
  await deps.notices.put("n", args)
  await deps.notices.delete("n")
  pending.delete("a")
}
