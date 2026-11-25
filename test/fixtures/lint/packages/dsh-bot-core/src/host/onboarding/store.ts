declare const deps: {
  onboardingState: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
}

export async function store(key: string, record: unknown) {
  await deps.onboardingState.put(key, record)
  await deps.onboardingState.delete(key)
}
