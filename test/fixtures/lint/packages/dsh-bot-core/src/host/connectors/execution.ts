declare const entry: {
  tool: {
    execute(args: unknown): Promise<unknown>
    recheck(args: unknown): Promise<unknown>
    snapshot(args: unknown): Promise<unknown>
  }
}

export async function run(args: unknown) {
  await entry.tool.snapshot(args)
  await entry.tool.recheck(args)
  return entry.tool.execute(args)
}
