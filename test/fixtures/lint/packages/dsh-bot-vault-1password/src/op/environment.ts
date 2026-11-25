declare const token: Uint8Array

export const environment = () => ({ OP_SERVICE_ACCOUNT_TOKEN: new TextDecoder().decode(token) })
