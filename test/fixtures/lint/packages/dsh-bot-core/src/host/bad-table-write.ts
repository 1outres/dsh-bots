interface Table {
  put(key: string, value: object): Promise<void>
  delete(key: string): Promise<void>
}
export async function write(deps: { table: Table }, table: Table) {
  await deps.table.put("a", {})
  await table.delete("a")
}
