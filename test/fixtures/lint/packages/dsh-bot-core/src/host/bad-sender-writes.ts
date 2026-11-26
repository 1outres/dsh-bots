declare const deps: {
  senderPolicies: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
  senderInquiries: {
    put(key: string, value: unknown): Promise<void>
  }
}

export async function store(id: string, value: unknown) {
  await deps.senderPolicies.put(id, value)
  await deps.senderPolicies.delete(id)
  await deps.senderInquiries.put(id, value)
}
