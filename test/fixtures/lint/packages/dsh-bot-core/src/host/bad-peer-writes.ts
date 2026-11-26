declare const deps: {
  peerGroups: {
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<unknown>
  }
  peerMembers: {
    put(key: string, value: unknown): Promise<void>
  }
  peerMessages: {
    delete(key: string): Promise<unknown>
  }
}

export async function store(id: string, value: unknown) {
  await deps.peerGroups.put(id, value)
  await deps.peerGroups.delete(id)
  await deps.peerMembers.put(id, value)
  await deps.peerMessages.delete(id)
}
