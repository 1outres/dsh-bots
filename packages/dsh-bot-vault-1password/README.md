# @1outres/dsh-bot-vault-1password

Host-only plugin (row id `bot-vault-1password`) that registers **1Password** as a password manager of the bots (`Bot.registerVaultProvider` of `@1outres/dsh-bot-core`, provider id `onepassword`, docs/specs/bot-vaults.md §10). The owner connects a **service account** in the dsh-bots settings → **Password managers**, then gives each bot logins (items) in its **Logins** settings; the browser and desktop connectors fill them without the model ever seeing a value.

Set it up with [docs/1password.md](../../docs/1password.md): a vault for the bots, a service account with read access to that vault only, its token in the settings.

- **Kinds**: passwords and one-time codes (`["password", "otp"]`), and the username (not a secret). **Passkeys cannot be used**: 1Password's SDK, CLI and Connect never hand out a passkey's private key. Nothing is ever written to 1Password.
- **Setup**: `token` (secret), the service account token (`ops_…`). It is kept in DSH's credential store by bot-core.

## The 1Password CLI

dsh-bots runs a 1Password CLI it installs itself; the `op` on `PATH` is never used.

- The version and, per platform (Linux and macOS, amd64 and arm64), the SHA-256 of the official zip and of the `op` inside it are pinned in `src/cli/release.ts`.
- On start the plugin checks `<DSH home>/bot-vault-1password/op/<version>/op` (`~/.dsh` or `$DSH_HOME`; every directory 0700, the binary 0700). When it is missing or does not match, it downloads `https://cache.agilebits.com/dist/1P/op2/pkg/v<version>/op_<os>_<arch>_v<version>.zip`, checks the zip's SHA-256, takes the file named exactly `op` from it (entry names are compared, never used as paths), checks its SHA-256 and installs it. Other versions under `op/` are removed. When a check fails nothing is used, and the next connection tries again.
- The provider's status in the settings says which step it is in (checking, downloading, installing), ready, or why it failed.
- Raising the version: infra/RELEASING.md, "1Password CLI".

## How op runs

- `spawn` without a shell (design rule 68). The environment is built whole (design rule 69: the package never reads `process.env`, so `OP_CONNECT_HOST` / `OP_CONNECT_TOKEN` or anything else of DSH's never reaches op): `OP_SERVICE_ACCOUNT_TOKEN`, `HOME` and `OP_CONFIG_DIR` (a 0700 directory per account session under the OS's temporary directory, removed when the session closes), `OP_FORMAT=json`, `OP_CACHE=false`.
- Every command has a timeout and a cap on its output; at most 4 run at once per account. stdout is kept as bytes; each chunk read is wiped once copied.
- Errors name a reason (token not accepted, no access, not found, rate limit, unreachable, timeout…) and the command, never op's output: stderr is only matched (op can echo parts of a malformed token), stdout holds values.
- The token reaches op as an environment variable, the one way op takes it, so it becomes a JS string for each command (the connection secret, like an OAuth client secret: docs/specs/bot-vaults.md §0). Between commands the session holds it as bytes and wipes them when it closes.

| Session method | op command                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `identify`     | `op whoami` (a service account: `<account URL>#<user uuid>`)                                                   |
| `listItems`    | `op vault list`, `op item list --vault <id> --categories Login,Password`, `op item get` for items that changed |
| `item`         | `op item get <item> --vault <vault>`                                                                           |
| `reveal`       | `op read --no-newline op://<vault>/<item>/<field>` (`?attribute=otp` for a code)                               |

- **Ids**: vault, item and field ids are letters, digits and `_` (one-time password fields are `TOTP_…`), at most 64; anything else is refused before op runs, so a secret reference names exactly one field. Fields whose id is anything else are not offered.
- **Fields**: the first field whose purpose is `USERNAME` (its value is the username), the first whose purpose is `PASSWORD` (other concealed fields are never offered) and the first of type `OTP`.
- **Reading op item get**: its JSON holds the values (concealed fields, the one-time password's seed and current code, the password history). `src/json/reader.ts` parses the bytes into spans and decodes only the strings asked for (ids, names, labels, purposes, URLs, the username); every other value stays bytes and the buffer is filled with zeros afterwards (design rule 70: bytes become text only there, in `src/op/environment.ts` for the token and in `src/op/runner.ts` for stderr). Tests watch every `TextDecoder.decode`, `Buffer.toString` and `String.fromCharCode` and check no value is ever decoded.
- **Reveal**: op's stdout bytes become the `SecretBytes` (`Bot.vaultKit().secret`) as they are. No value is cached or written anywhere (design rule 71: only the installer writes a file).

## Rate limits

1Password limits service accounts: on Personal and Teams accounts 1,000 reads an hour per token (Business: more), and a daily limit per account. Each `op item get` and `op read` is one read. So the session

- keeps item metadata (never values) by the item's `updated_at`: a listing runs `op item get` only for items that are new or changed;
- answers the owner's searches in the Logins dialog from one listing for 30 seconds.

A fill costs two reads (bot-core reads the item, then the value). A rate limit is reported as such.

## Layout

| Path              | What                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `src/cli/`        | The pinned release, download, zip extraction, the installer and its status cell              |
| `src/op/`         | op's environment and home, the runner, failure reasons, secret references, mapping op's JSON |
| `src/json/`       | The byte-level JSON reader                                                                   |
| `src/session.ts`  | One account's `VaultSession`                                                                 |
| `src/provider.ts` | The `BotVaultProvider`                                                                       |
| `src/index.ts`    | Wiring: the data directory, the installer started with the plugin, the registration          |

Tests run a fake op (a Node script logging its argv and environment) and never reach 1Password.
