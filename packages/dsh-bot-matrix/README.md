# @1outres/dsh-bot-matrix

Connects each bot of [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) to a Matrix account of its own on your self-hosted homeserver (Synapse or Tuwunel). Each bot has one home: a direct chat with its owner, or a room everyone in it can talk in. Messages there reach the bot's Main session; its replies, files, questions, approvals, connector actions and credential incident reports come back there.

It needs `@1outres/dsh-bot-core` and is part of the `@1outres/dsh-bots` bundle.

## Matrix setup

dsh-bots reaches the homeserver as an **application service** (no HTTP endpoint of its own: `url: null`) and makes each bot's Matrix user itself, `@<prefix>_<bot id>:<server name>`. Every request is sent with the application service token and the bot's user id (identity assertion), so no per-bot login or token is kept. End-to-end encryption is not supported: an encrypted room cannot be a home, and the direct chats the bots make are not encrypted.

1. Make a token for the application service: `openssl rand -hex 32` (and a second one for `hs_token`, which dsh-bots does not use).
2. Write the registration file below, with your prefix (`dshbots` here) and your server name, and register it with the homeserver (Synapse or Tuwunel below).
3. In DSH: dsh-bots settings → **Matrix**. Choose the homeserver software, enter the Client-Server API URL, the `as_token`, the prefix, and optionally a default owner (`@you:example.org`). The settings are checked against the homeserver when they are complete. The section shows the registration file for what you entered, ready to copy.
4. Turn on **Turn on for new bots** to have each new bot set up in a direct chat with the default owner (you can untick it in the New bot dialog), or turn Matrix on in a bot's settings → Channels and pick its home and owners there.
5. Accept the bot's invitation to the direct chat in your Matrix client. To use a room as the home instead, invite the bot's user (shown in its Channels settings) to the room and pick the room as the home.

```yaml
id: dsh-bots
url: null
as_token: <as_token>
hs_token: <hs_token>
sender_localpart: dshbots
rate_limited: false
namespaces:
  users:
    - exclusive: true
      regex: "@dshbots_.*:matrix\\.example\\.org"
  aliases: []
  rooms: []
```

`rate_limited: false` keeps the bots' messages out of Synapse's rate limits, and `exclusive: true` keeps anyone else from registering users in the bots' namespace. `sender_localpart` must be the prefix.

### Synapse

Save the file where Synapse can read it (for example `/etc/matrix-synapse/dsh-bots.yaml`), list it in `homeserver.yaml` and restart Synapse:

```yaml
app_service_config_files:
  - /etc/matrix-synapse/dsh-bots.yaml
```

When a bot is deleted, its Matrix user leaves its rooms, its name and avatar are cleared and the user is deactivated.

### Tuwunel

Save the file in the directory `appservice_dir` names in `tuwunel.toml` and restart Tuwunel (or paste it to `!admin appservices register` in the admin room):

```toml
[global]
appservice_dir = "/etc/tuwunel/appservices"
```

Tuwunel cannot deactivate an application service's user: when a bot is deleted its Matrix user leaves its rooms and its name and avatar are cleared, but the account stays. An admin can deactivate it with `!admin users deactivate <user id>`.

## In Matrix

- Messages: text, emotes and one attachment per message reach the bot; 👀 marks a delivered message and ⚠️ one that was not (with the reason).
- Commands: `!stop`, `!status`, `!new`, `!pending` and `!help` as the whole message.
- Questions, approvals and plan reviews come as cards: react with the emoji the bot put on the card (1️⃣…🔟, ✅, 🔁, ❌, ⏸️), or reply to the card (a number, `1,3`, your own answer, `-` to skip; a reply to a plan review sends it back with your reply as the feedback).
- Connector actions waiting for a decision come as cards (✅ approve, ❌ reject) and a list of pending ones that the bot pins when the room lets it.
- The bot's own texts follow the **Notice language** of its Matrix settings.
