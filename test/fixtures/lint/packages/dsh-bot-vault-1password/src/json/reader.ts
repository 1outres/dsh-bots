declare const field: Uint8Array

export const text = () => new TextDecoder("utf-8", { fatal: true }).decode(field)
