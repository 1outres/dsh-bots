# dsh-bot-fake-vault (verification only)

A fake password manager for bot-core's vaults (docs/specs/bot-vaults.md §14). Never built, published or bundled; install it only into verification DSHs:

- `plugin_manager` `install_bundle` (or **Plugins** > **Add plugin**) with the absolute path of `dev/fake-vault`. It registers the provider `fake-vault` (shown as DEV).
- In the dsh-bots settings, **Password managers** > Fake vault: any token; leave **Items file** empty for `items.example.json` (three items: one with a password and a TOTP seed, one for the local test site with a passkey, one whose password is too short for the leak guard), or give the path of a JSON file of the same shape on the Host.
- Passkeys are made each time an account's session opens. With `FAKE_VAULT_PASSKEYS=<file>` in DSH's environment, their public halves are written there for the test pages.

- It also registers the connector `vaultprobe` (off until enabled per bot) with one tool, `vaultprobe_fill`, which takes one field of a login for a page origin through `run.vault` and only reports how many bytes it got: give a login to "Vault probe" to try the checks and the use history without a browser.

## Test pages

`node dev/fake-vault/cli.js --port 8443 --passkeys <file>` serves, for the example items, `/login` (username and password, then a one-time code for items with a TOTP seed), `/passkey` (WebAuthn sign-in with the fake vault's passkeys for `localhost`) and `/account` (shows the signed-in user's password, to try the leak guard). Run it inside a bot's VM on `localhost`, a secure context.
