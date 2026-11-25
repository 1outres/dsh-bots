# Contributing to dsh-bots

Each plugin is its own npm package and its own bundle under `packages/`; `@1outres/dsh-bots` installs all of them at once.

## Requirements

- DeepSeek Harness exactly 0.2.2-rc.5
- Node.js 22 or newer, pnpm 12 (`nix develop` provides both)

## Development

```
pnpm install
pnpm build        # packages/*/src -> packages/*/lib (esbuild)
pnpm dev          # watch mode
pnpm typecheck
pnpm lint
pnpm test
```

Install a local checkout into DSH with **Plugins** > **Add plugin**, giving the directory of `packages/dsh-bots` or of a single plugin package.

## Packages

| Package                              | Row id                  | What it does                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@1outres/dsh-bot-core`              | `bot-core`              | Registers the `bot` Host service that the other bot plugins use. Adds no behavior on its own.                                                                                                                                                                                                                                                                    |
| `@1outres/dsh-bot-vm`                | `bot-vm`                | Runs every bot in its own Incus VM: bot Agents execute there over SSH, never on the Host.                                                                                                                                                                                                                                                                        |
| `@1outres/dsh-bot-web`               | `bot-web`               | Searches the web and reads pages for every bot through Exa, with the bots' own Exa API key (dsh-bots settings → Web lookup), apart from the Host's web settings.                                                                                                                                                                                                 |
| `@1outres/dsh-bot-discord`           | `bot-discord`           | Connects each bot to its own Discord bot: allowed users' DMs (with attachments) reach the bot's Main session; its replies, files and notices come back; its questions, approvals and plan reviews are answered with buttons, menus and forms; connector actions are posted to the approvers' DMs and decided there; `/stop`, `/status` and (owners only) `/new`. |
| `@1outres/dsh-bot-connector-desktop` | `bot-connector-desktop` | The `desktop` connector: a desktop in each bot's VM (XFCE, LibreOffice, Google Chrome) that the bot reads through the accessibility tree and operates with input, and that a person watches and takes over in the bot's Desktop panel; off until enabled per bot.                                                                                                |
| `@1outres/dsh-bot-connector-browser` | `bot-connector-browser` | The `browser` connector: each bot drives the Google Chrome on its VM's desktop with Playwright MCP inside the VM (snapshots, forms, screenshots); requires the desktop connector, so a person sees and takes over the same Chrome in the Desktop panel; off until enabled per bot.                                                                               |
| `@1outres/dsh-bot-connector-google`  | `bot-connector-google`  | Gmail and Google Calendar connectors: bots act as the Google accounts assigned to them (tokens on the Host), sending and changes others see only after the owner approves, new mail and calendar changes as events.                                                                                                                                              |
| `@1outres/dsh-bots`                  | —                       | Bundle that inserts every `bot-*` row.                                                                                                                                                                                                                                                                                                                           |

`dev/fake-google` is a fake Google (OAuth, Gmail, Calendar) for the Google connector's tests and verification DSHs (`node dev/fake-google/cli.js`); like the probes it is never built, published or bundled.

Select either the `@1outres/dsh-bots` bundle or a plugin's own bundle for a given plugin, never both: they insert the same row id.

## Adding a plugin

```
pnpm new-plugin discord   # creates packages/dsh-bot-discord with row id bot-discord
```

The generator also adds the package to the `dsh-bots` bundle. It leaves TODO text that `pnpm test` rejects until you write the descriptions.

A plugin that uses the core service:

1. Add `"@1outres/dsh-bot-core": "workspace:*"` to its `dependencies`.
2. Declare `export const inject = ["bot"]` so the plugin stays inactive without `bot-core`.
3. Read the service with `botOf(ctx)` from `@1outres/dsh-bot-core`.

The build keeps every `@1outres/*` import external, so a value import of bot-core (such as `botOf`) needs bot-core resolvable next to the plugin at run time. A plugin installed into a profile on its own (`@1outres/dsh-bot-vm`, `@1outres/dsh-bot-discord`) instead lists bot-core in `peerDependencies`, imports only its types, and reads the service with `ctx.get("bot")` in its `src/index.ts` (the one exception to rule 8 there); `test/packages-bundle.test.ts` checks that no built `lib/*.js` contains another package's code.

### Channel plugins

A channel plugin (Discord; later Telegram, Slack…) registers a `BotChannel` with `registerChannel`: an id, a name, optional `setup` steps (one short line each, listed by the welcome guide), the **fields** of its per-bot settings (`secret`, `text`, `list`), which list field names the bot's **owners** there (`owners`), its **capabilities**, an optional `formatHint` (one English line on how it renders messages, for the bot's prompt) and `connect(link)`. The contract (`packages/dsh-bot-core/src/channel-contract.ts`) is a set of channel-independent units of exchange with the bot's Main session:

- **Outputs** (bot-core → channel, `BotChannelConnection.receive`, one at a time, in order): a reply, a file the bot sends, an interaction opened, updated (a timed question's wait) or closed (with who answered it, the Web UI or which channel, and the answer; or withdrawn), a turn state (started, completed, failed, cancelled), a connector action created or changed (to a channel that presents them).
- **Inputs** (channel → bot-core, on the `BotChannelLink`): a message (where it was written, who wrote it — id, display name, handle, whether a bot —, text and attachments, `deliver`; bot-core decides whether the sender is an owner and writes the header line the bot reads it with), an answer to an interaction by id (`answer`), "a person started answering" for a timed question (`hold`), an operation (`run("stop" | "status" | "new", person)`; `new` only for the owners the settings list), a decision on a connector action with the person's channel id (`decide`, taken only from the owners the settings list); plus `report` (the connection's state, shown in the Channels dialog) and `activity()`.
- **Capabilities**: attachments (count and size), files (size), turns, which interaction kinds, which commands, and whether it presents connector actions to the owners (`connectorActions: true`, which needs `owners`; an empty owners list lets nobody decide). bot-core sends a channel nothing it did not declare and refuses input beyond it; there is no substitute presentation (what a channel cannot show is answered in the Web UI).

bot-core does everything that is not specific to the channel (bot-core's README, "Channels"): it stores each bot's settings (secrets in DSH's credential store), renders the settings form in the bot's **Channels** dialog from the fields, connects every listed bot whose settings are enabled and complete, turns messages into prompts the way DSH's Web composer sends them, saves attachments in the bot's environment, and runs the operations. A channel only presents and converts. A settings change closes the connection and connects again. Channel plugins never touch DSH's session, tool or credential services (rules 16, 17) nor the Host's files and processes (rule 35).

`tsconfig.json` maps `@1outres/dsh-bot-*` to each package's `src`, so type checking needs no build. At runtime the package resolves to `lib/index.js`.

## Verification-only plugins

`dev/connector-probe` holds dummy connectors for trying the Connectors settings and connector approvals: `probemail` (Main only, `probemail_send` asks first with a snapshot read from the VM and only records the message), `probe` (every session of the bot: it prepares the bot's VM with a marker file, keeps a resident `cat` process per bot, runs commands there and returns a PNG drawn in the VM; `probe_hidden` is disallow) and, with `CONNECTOR_PROBE_MANY_TOOLS=1`, `probewide` (30 tools named like the browser connector's, a choice and an integer setting). With `CONNECTOR_PROBE_DIR` set, a file trigger enables them, reads their states and changes permissions; unset, it touches no file. It lives outside `packages/`, so it is never built, published or part of `@1outres/dsh-bots`, but it is a bundle of its own: install it with `plugin_manager` `install_bundle` (or **Plugins** > **Add plugin**) and the absolute path of `dev/connector-probe`, without a restart, and remove it when the test is over. See [its README](dev/connector-probe/README.md), including the VM memory Probe needs under `CONNECTOR_PROBE_MIN_MEMORY_MIB`.

`dev/web-probe` is the spike of `docs/specs/bot-web.md`: one package with a Host role (a fake Exa API and file triggers) and a group role (a search provider inside an isolated preset group), to check a second `@deepseek-ai/dsh-web` against the Host's (see its header). Verification profiles only, like the connector probe.

## Design rules

`pnpm lint` and `pnpm test` enforce the design of `dsh-bot-core` and of channel plugins: see [docs/design-rules.md](docs/design-rules.md).

## Releasing

[infra/RELEASING.md](infra/RELEASING.md) has the steps (npm packages, the base image on GitHub Releases, `infra/release.env`).
