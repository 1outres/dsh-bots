export const MCP_DIR = "/opt/dsh-browser/mcp"
export const MCP_SHRINKWRAP = `${MCP_DIR}/npm-shrinkwrap.json`
export const MCP_CLI = `${MCP_DIR}/node_modules/@playwright/mcp/cli.js`
export const HELPER_DIR = "/opt/dsh-browser/helper"
export const FILL_HELPER = `${HELPER_DIR}/dsh-browser-fill.mjs`
export const PASSKEY_HELPER = `${HELPER_DIR}/dsh-browser-passkey.mjs`
export const CDP_HOST_PORT = "127.0.0.1:9222"
export const CDP_ENDPOINT = `http://${CDP_HOST_PORT}`
export const OUTPUT_MAX_BYTES = 256 << 20

export interface VmUser {
  readonly uid: number
  readonly name: string
  readonly home: string
}

export const outputDir = (user: VmUser) => `${user.home}/.cache/dsh-browser/output`
export const stagingDir = (user: VmUser) => `${user.home}/.cache/dsh-browser/staging`
export const helperStagingDir = (user: VmUser) => `${user.home}/.cache/dsh-browser/helper-staging`
