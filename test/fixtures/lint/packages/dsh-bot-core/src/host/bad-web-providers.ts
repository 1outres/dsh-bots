declare const ctx: {
  web: {
    registerSearchProvider(provider: object): () => void
    registerFetchProvider(provider: object): () => void
  }
}

export function apply() {
  ctx.web.registerSearchProvider({ id: "exa" })
  ctx.web?.registerFetchProvider({ id: "http" })
}
