const PREFIX = new TextEncoder().encode("ops_")
const MAX_TOKEN_BYTES = 16 * 1024

const tokenByte = (byte: number) =>
  (byte >= 0x30 && byte <= 0x39) ||
  (byte >= 0x41 && byte <= 0x5a) ||
  (byte >= 0x61 && byte <= 0x7a) ||
  byte === 0x2b ||
  byte === 0x2d ||
  byte === 0x2e ||
  byte === 0x2f ||
  byte === 0x3d ||
  byte === 0x5f

export function tokenProblem(token: Uint8Array): string | undefined {
  if (token.length <= PREFIX.length || token.length > MAX_TOKEN_BYTES) {
    return "a 1Password service account token starts with ops_ and is a few hundred characters long"
  }
  if (!PREFIX.every((byte, index) => token[index] === byte)) {
    return "a 1Password service account token starts with ops_"
  }
  if (!token.every(tokenByte)) {
    return "the service account token has characters a token does not (spaces, line breaks or quotes?)"
  }
  return undefined
}

export interface OpHomePaths {
  readonly home: string
  readonly config: string
}

export const OP_ENVIRONMENT_KEYS = [
  "OP_SERVICE_ACCOUNT_TOKEN",
  "HOME",
  "OP_CONFIG_DIR",
  "OP_FORMAT",
  "OP_CACHE",
] as const

export type OpEnvironment = Readonly<Record<(typeof OP_ENVIRONMENT_KEYS)[number], string>>

export function opEnvironment(token: Uint8Array, paths: OpHomePaths): OpEnvironment {
  return {
    OP_SERVICE_ACCOUNT_TOKEN: new TextDecoder("utf-8", { fatal: true }).decode(token),
    HOME: paths.home,
    OP_CONFIG_DIR: paths.config,
    OP_FORMAT: "json",
    OP_CACHE: "false",
  }
}
