declare const connector: { preparation: { prepare(): Promise<void>; unprepare(): Promise<void> } }

export async function prepare() {
  await connector.preparation.prepare()
  await connector.preparation.unprepare()
}
