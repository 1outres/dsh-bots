declare const deps: {
  onboardingState: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
  store: { change(value: unknown): Promise<void> }
}

export async function write(key: string, record: unknown) {
  await deps.onboardingState.put(key, record)
  await deps.onboardingState.delete(key)
  await deps.store.change(record)
}
