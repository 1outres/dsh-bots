import type {
  BotConnectorRun,
  BotConnectorTool,
  BotConnectorToolDefinition,
  BotCredential,
  BotVaultAccess,
  ConnectorPreview,
  SecretBytes,
  VaultKit,
} from "@1outres/dsh-bot-core"
import type { BrowserConnections } from "../connections"
import type { BrowserAttachment } from "../session"
import { explain, withReconnection } from "../tools"
import { CDP_HOST_PORT, FILL_HELPER } from "../vm/layout"
import { HelperFailureError } from "./failures"
import { type HelperRun, startHelper } from "./helper"
import { markElement, markTab } from "./marks"
import { PASSKEY_SECONDS } from "./passkeys"
import { type FillOrder, type FillRequest, HelperProtocolError, type HelperReply } from "./protocol"

export const FILL_FIELDS = ["username", "password", "otp"] as const
type FillField = (typeof FILL_FIELDS)[number]

const FILL_TIMEOUT_MS = 60_000
const EXCLUSIVE_PAGE = "page"

export interface VaultToolDeps {
  readonly connections: BrowserConnections
  readonly kit: VaultKit
  mark(): string
  deadline(ms: number): AbortSignal
}

type Run = BotConnectorRun<BrowserAttachment>
type Parameters = NonNullable<BotConnectorTool["parameters"]>

const tool = <const S extends Parameters>(
  definition: BotConnectorTool<S, BrowserAttachment>,
): BotConnectorToolDefinition<BrowserAttachment> =>
  definition as BotConnectorToolDefinition<BrowserAttachment>

function vaultOf(run: Run): BotVaultAccess {
  if (run.vault === undefined) throw new Error("this run has no access to the bot's logins")
  return run.vault
}

const preview = (title: string, fields: ConnectorPreview["fields"]): ConnectorPreview => ({
  title,
  fields,
})

async function mark(run: Run, args: { readonly function: string; readonly target?: string }) {
  let result: Awaited<ReturnType<BrowserAttachment["mcp"]["callTool"]>>
  try {
    result = await run.attachment.mcp.callTool(
      "browser_evaluate",
      args.target === undefined
        ? { function: args.function }
        : { element: "the field to fill", target: args.target, function: args.function },
      { signal: run.signal, timeoutMs: 30_000 },
    )
  } catch (error) {
    throw explain(error)
  }
  if (result.isError) {
    const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
    throw new Error(
      `Playwright MCP: ${text.join("\n").slice(0, 2_000) || "the target was not found"}`,
    )
  }
}

async function expect<K extends HelperReply["kind"]>(
  helper: HelperRun,
  kind: K,
): Promise<Extract<HelperReply, { kind: K }>> {
  const reply = await helper.next()
  if (reply.kind === "error") throw new HelperFailureError(reply.code)
  if (reply.kind !== kind) throw new HelperProtocolError("out of order")
  return reply as Extract<HelperReply, { kind: K }>
}

function requireKind(credential: BotCredential, kind: BotCredential["kinds"][number]) {
  if (credential.kinds.includes(kind)) return
  throw new Error(
    kind === "passkey"
      ? `"${credential.label}" has no passkey this bot may use (its password manager may not hand out passkeys); sign in with browser_fill_credential instead`
      : `"${credential.label}" has no ${kind} this bot may use`,
  )
}

async function fill(
  deps: VaultToolDeps,
  run: Run,
  args: { credential: string; field: FillField; ref: string; submit?: boolean | undefined },
): Promise<string> {
  const vault = vaultOf(run)
  const credential = await vault.describe(args.credential)
  requireKind(credential, args.field)
  const markValue = deps.mark()
  await mark(run, { target: args.ref, function: markElement(markValue) })
  const signal = AbortSignal.any([run.signal, deps.deadline(FILL_TIMEOUT_MS)])
  const helper = await startHelper(run.environment, FILL_HELPER, signal, deps.kit)
  let secret: SecretBytes | undefined
  try {
    const request: FillRequest = { devtools: CDP_HOST_PORT, mark: markValue, field: args.field }
    await helper.send(request)
    const { origin } = await expect(helper, "located")
    try {
      secret = await vault.reveal(args.credential, args.field, { kind: "browser", origin })
    } catch (error) {
      await helper.end()
      await expect(helper, "cancelled")
      const reason = error instanceof Error ? error.message : "refused"
      throw new Error(
        `the ${args.field} of "${credential.label}" may not be filled in ${origin}: ${reason}`,
      )
    }
    const submit = args.submit === true
    await helper.sendSecret((length): FillOrder => ({ fill: { origin, submit, length } }), secret)
    const filled = await expect(helper, "filled")
    return `Filled the ${args.field} of "${credential.label}" in ${origin}${filled.submitted ? " and pressed Enter" : ""}. The value is not shown to you; take a browser_snapshot to see the page.`
  } finally {
    secret?.wipe()
    helper.terminate()
  }
}

export function vaultTools(
  deps: VaultToolDeps,
): readonly BotConnectorToolDefinition<BrowserAttachment>[] {
  return [
    tool({
      name: "fill_credential",
      description:
        "Type one field (username, password or otp, a current one-time code) of one of your logins into a field of the page, by its ref from browser_snapshot, without you seeing the value. The field's frame must be one of the login's sites; a password goes only into a password field. Set submit to press Enter afterwards. List your logins with credentials_list first.",
      parameters: {
        credential: { type: "string", required: true, description: "The login's handle (cred-…)." },
        field: {
          type: "string",
          enum: FILL_FIELDS,
          required: true,
          description: "Which field of the login.",
        },
        ref: {
          type: "string",
          required: true,
          description: "The ref of the page's field from browser_snapshot.",
        },
        submit: { type: "boolean", description: "Press Enter in the field afterwards." },
      },
      permission: "allow",
      exclusive: EXCLUSIVE_PAGE,
      vault: true,
      preview: (args) =>
        preview("Fill a login of the bot in its browser?", [
          { label: "login", value: args.credential },
          { label: "field", value: args.field },
          { label: "element", value: args.ref },
          ...(args.submit === true ? [{ label: "then", value: "press Enter" }] : []),
        ]),
      async execute(args, run) {
        const text = await fill(deps, run, args)
        return withReconnection({ text }, deps.connections, run.bot.id)
      },
    }),
    tool({
      name: "use_passkey",
      description: `Offer the passkey of one of your logins to the current tab for ${PASSKEY_SECONDS} seconds, without you seeing it: right after this, press the site's sign-in with a passkey. It is used once at most and only while the tab stays on the same site. List your logins with credentials_list first.`,
      parameters: {
        credential: { type: "string", required: true, description: "The login's handle (cred-…)." },
      },
      permission: "allow",
      exclusive: EXCLUSIVE_PAGE,
      vault: true,
      preview: (args) =>
        preview("Offer a passkey of the bot in its browser?", [
          { label: "login", value: args.credential },
        ]),
      async execute(args, run) {
        const text = await offerPasskey(deps, run, args)
        return withReconnection({ text }, deps.connections, run.bot.id)
      },
    }),
  ]
}

async function offerPasskey(deps: VaultToolDeps, run: Run, args: { credential: string }) {
  const vault = vaultOf(run)
  const credential = await vault.describe(args.credential)
  requireKind(credential, "passkey")
  const markValue = deps.mark()
  await mark(run, { function: markTab(markValue) })
  const tab = await run.attachment.passkeys.locate(markValue)
  let passkey: Awaited<ReturnType<BotVaultAccess["passkey"]>>
  try {
    passkey = await vault.passkey(args.credential, { kind: "browser", origin: tab.origin })
  } catch (error) {
    tab.cancel()
    const reason = error instanceof Error ? error.message : "refused"
    throw new Error(
      `the passkey of "${credential.label}" may not be used in ${tab.origin}: ${reason}`,
    )
  }
  await tab.offer(passkey)
  return `The passkey of "${credential.label}" is offered to ${tab.origin} for ${PASSKEY_SECONDS} seconds. Now press the site's sign-in with a passkey (browser_click), then take a browser_snapshot. It goes away once used, when the tab leaves the site, or at your next browser_use_passkey.`
}
