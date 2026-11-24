declare const web: {
  registerSearchProvider(provider: object): () => void
  registerFetchProvider(provider: object): () => void
}

export function apply() {
  web.registerSearchProvider({ id: "bot-core" })
  web.registerFetchProvider({ id: "bot-core" })
}
