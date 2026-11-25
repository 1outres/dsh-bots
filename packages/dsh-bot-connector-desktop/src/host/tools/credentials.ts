/**
 * Typing the bot's logins into desktop applications (docs/specs/bot-vaults.md §9).
 * The agent chooses and checks the field first, bot-core then checks and
 * hands over the value, and the agent types it only if that field still has
 * the focus. The value goes from bot-core to the agent as bytes and never
 * into a result.
 */
import type { BotConnectorToolDefinition, BotVaultAccess } from "@1outres/dsh-bot-core"
import { TYPED_FIELDS } from "../agent/protocol"
import type { DesktopSession } from "../session"
import { ELEMENT_DESCRIPTION, elementId } from "./arguments"
import { argumentFields, type DesktopRun, type DesktopToolDeps, desktopTool } from "./define"

const FIELD_NAMES = { username: "username", password: "password", otp: "one-time code" } as const

function vaultOf(run: DesktopRun): BotVaultAccess {
  if (run.vault === undefined) throw new Error("this run was given no access to the bot's logins")
  return run.vault
}

export function credentialTools(
  deps: DesktopToolDeps,
): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "type_credential",
        description:
          "Type one field of a login the owner gave you (credentials_list: its handle and fields; only logins with desktop: true) into a field of a desktop application, without you ever seeing the value. " +
          "Focus the field first (desktop_act focus) or give its element. A password goes only into a password field; a username or one-time code into any editable text field. The field's text is replaced. " +
          "Not for web browsers: in Chrome use browser_fill_credential, which checks the site. submit presses Return afterwards. " +
          "Never ask people for a password, never write one down, never read it back from the screen.",
        parameters: {
          credential: {
            type: "string",
            required: true,
            description: "The login's handle from credentials_list (cred-…).",
          },
          field: { type: "string", enum: TYPED_FIELDS, required: true },
          element: {
            type: "string",
            description: `The field to type into, instead of the focused one. ${ELEMENT_DESCRIPTION}`,
          },
          submit: { type: "boolean", description: "Press Return after typing. Default false." },
        },
        kind: "operate",
        vault: true,
        preview: (args) => ({
          title: "Type a login on the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const vault = vaultOf(run)
          const login = await vault.describe(args.credential)
          const target = await run.attachment.agent.call(
            "secret_target",
            {
              field: args.field,
              ...(args.element === undefined ? {} : { element: elementId(args.element) }),
            },
            run.signal,
          )
          const secret = await vault.reveal(args.credential, args.field, {
            kind: "desktop",
            application: target.application,
          })
          const typed = await run.attachment.agent.callSecret(
            "type_secret",
            { token: target.token, submit: args.submit ?? false },
            secret,
            run.signal,
          )
          const into = `${typed.application} (${target.role} "${target.name}")`
          return {
            text: `Typed the ${FIELD_NAMES[args.field]} of "${login.label}" into ${into}${args.submit === true ? ", then pressed Return" : ""}. The value is not shown to you, by design.`,
            data: { activeWindow: typed.active_window, focus: typed.focus },
          }
        },
      },
      deps,
    ),
  ]
}
