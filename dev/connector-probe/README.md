# Connector probe (verification only)

Dummy bot connectors for trying the Connectors settings and connector approvals of `@1outres/dsh-bot-core`. Nothing is sent anywhere. It lives in `dev/`, outside `packages/`: it is never built, published or part of the `@1outres/dsh-bots` bundle. Remove it when the test is over.

It needs `@1outres/dsh-bot-core` (the `bot` service) in the same profile.

## Connectors

- **Probe mail** (`probemail`, Main session only, always registered): `probemail_send` (Ask) reads the VM's hostname for the approval card, then only records the message. No preparation, no VM memory.
- **Probe** (`probe`, every session, always registered): prepares the bot's VM (a marker file under `~/.cache/dsh-connector-probe`), keeps a resident `cat` per bot and offers `probe_echo`, `probe_exec`, `probe_screenshot` (a PNG drawn in the VM) and `probe_relay`; `probe_hidden` is Disallow.
- **Probe wide** (`probewide`, every session, only with `CONNECTOR_PROBE_MANY_TOOLS=1`): 30 tools named like the browser connector's, a choice and an integer setting, to read a long tool list.

## Environment

All optional, read by the Host process when the plugin activates:

- `CONNECTOR_PROBE_DIR`: enables the file trigger and the journal below. Unset, the plugin touches no file.
- `CONNECTOR_PROBE_MIN_MEMORY_MIB`: Probe's `minimumSpec.memoryMiB`: a bot whose VM spec has less memory cannot turn it on, and a bot with it on cannot lower its memory below it. Unset, Probe needs none.
- `CONNECTOR_PROBE_MANY_TOOLS=1`: registers Probe wide.

### File trigger

With `CONNECTOR_PROBE_DIR` set, JSON files dropped in `$CONNECTOR_PROBE_DIR/trigger/*.json` are run in name order and moved to `done/`; every result, tool call, preparation and state change is appended to `$CONNECTOR_PROBE_DIR/results.log`:

```json
{"op":"enable","botId":"…","connectorId":"probe","enabled":true,"values":{}}
{"op":"states","botId":"…"}
{"op":"retry","botId":"…","connectorId":"probe"}
{"op":"permission","botId":"…","connectorId":"probe","tool":"echo","permission":"allow"}
{"op":"list","botId":"…"}
```

`permission` is `allow`, `ask`, `disallow` or `null` (back to the default). Connector actions are decided in the Web UI or a channel, never by the trigger.

## Install

Install it as a local directory bundle, with the absolute path of this directory (for example `/path/to/dsh-bots/dev/connector-probe`):

- the `plugin_manager` tool: `install_bundle` with that path as `target`, or
- **Plugins** > **Add plugin** > **Install a third-party plugin** in the Web UI, entering that path, then turning its row on in **Installed plugins** (it is installed off).

It activates without a restart. The installed copy is a link to this directory, so it runs whatever is checked out here; a changed file needs a DSH restart to load.

## Try an approval

1. Open the bot's settings, **Connectors**, and turn **Probe mail** on.
2. On Discord, put your own user id in the channel's **Connector approvers** to get approval cards in your DMs.
3. Ask the bot, in its Main session, to send a message with `probemail_send`.
4. Approve or reject the card in the session's approvals tray (or on Discord). Approved, the tool answers `{ "sent": true }` and records the message; nothing leaves DSH.

## Remove

`plugin_manager` `remove_bundle` with target `dsh-bot-connector-probe` (`list_bundles` shows the exact name), or **Uninstall** on its page in **Plugins**. No restart is needed. Turn its connectors off in each bot first if you want their saved settings gone too.

## Caution

- Turning **Probe** on prepares the bot's VM (writes the marker file, starts a process there). While `CONNECTOR_PROBE_MIN_MEMORY_MIB` is set, the switch is refused for a bot whose VM spec has less memory (the bot's VM page raises it).
- **Probe wide** asks no memory, but every one of its tools is visible to the bot; keep it off outside verification DSHs.
- Use **Probe mail** to try approvals: it asks first, needs no preparation and changes nothing in the VM.
