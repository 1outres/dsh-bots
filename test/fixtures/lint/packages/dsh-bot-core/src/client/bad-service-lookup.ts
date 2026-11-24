export function lookup(ctx: { get(name: string): unknown }, map: Map<string, number>) {
  map.get("x")
  return ctx.get("workspaceController") // rule: 8
}
