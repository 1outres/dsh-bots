/**
 * Where the browser connector lives in the bot's environment, and what it
 * reaches there: Playwright MCP's installation and the desktop's Chrome.
 */
export const MCP_DIR = "/opt/dsh-browser/mcp"
export const MCP_SHRINKWRAP = `${MCP_DIR}/npm-shrinkwrap.json`
export const MCP_CLI = `${MCP_DIR}/node_modules/@playwright/mcp/cli.js`
/** The desktop connector's Chrome answers DevTools here, on loopback only (its vm/bin/chrome-run). */
export const CDP_ENDPOINT = "http://127.0.0.1:9222"
/** Most bytes of screenshots and snapshots the server keeps on disk before it drops the oldest. */
export const OUTPUT_MAX_BYTES = 256 << 20

/** The bot's account in its environment. */
export interface VmUser {
  readonly uid: number
  readonly name: string
  readonly home: string
}

/** Where the server writes the files its results link to (screenshots, snapshots, PDFs), readable by the bot. */
export const outputDir = (user: VmUser) => `${user.home}/.cache/dsh-browser/output`
export const stagingDir = (user: VmUser) => `${user.home}/.cache/dsh-browser/staging`
