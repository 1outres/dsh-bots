# @1outres/dsh-bot-connector-browser

A bot-core connector (`browser`) that lets each bot drive the **Google Chrome on its VM's desktop** with [Playwright MCP](https://github.com/microsoft/playwright-mcp) running inside the VM: page snapshots, clicks and forms, screenshots, tabs, network and console. A person sees the same Chrome in the bot's **Desktop** panel and can take it over. Row id `bot-connector-browser`. Host only; it needs `@1outres/dsh-bot-core`, a bot environment (`@1outres/dsh-bot-vm`) and the desktop connector (`@1outres/dsh-bot-connector-desktop`).

It is off for every bot until enabled (or the bot was created with **Turn on the desktop and browser**, `creationOption: "workstation"`). It `requires: ["desktop"]`: a bot turns it on only while the desktop is on, and the desktop off only after it (the settings say "Turn on Desktop first" / "Turn off Browser first"); bot-core keeps it `unavailable` while the desktop is off, missing or failed, `preparing` (stage `requirements`) while the desktop prepares, prepares it again whenever the desktop became ready again, and takes it out of ready (closing its server) whenever the desktop leaves ready. There is no headless browser and no other path.

## Who does what

| Part                                                                                                                                                                                                                                                                                       | Owner             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Google Chrome: Google's apt source and key, the `google-chrome-stable` package, the resident user service `dsh-desktop-chrome` (own profile `~/.local/share/dsh-desktop/chrome`, DevTools on `127.0.0.1:9222`, `--force-renderer-accessibility`), every way of launching it routed into it | desktop connector |
| Playwright MCP (pinned, `/opt/dsh-browser/mcp`), its tools, attaching it to that Chrome over DevTools                                                                                                                                                                                      | this connector    |

Chrome is one per VM because a second Chrome on the same profile only hands its arguments to the first (`Opening in existing browser session`): whoever starts first decides whether DevTools is on. So the only owner is the desktop, which starts it as a user service with DevTools always on, and replaces `/usr/bin/google-chrome-stable` (`dpkg-divert`) with a script that starts that service and opens the arguments in it — the menu, `xdg-open`, `x-www-browser`, exo and `desktop_launch chrome` all end there. Chrome 136 and later refuse remote debugging on the default profile, hence the own profile. Closing Chrome's last window restarts it (`Restart=always`).

## What runs where

- **Host**: the connector definition, a JSON-RPC client of MCP, and the tools. It reaches the VM only through bot-core's environment (`exec`, `spawn`, `writeFile`, `sudo -n` to install); no Playwright and no browser on the Host.
- **VM**: Playwright MCP, started per bot by the connector's resident resource with `spawn` (`node /opt/dsh-browser/mcp/node_modules/@playwright/mcp/cli.js --caps vision,pdf --no-webmcp --cdp-endpoint http://127.0.0.1:9222 --codegen none --file-paths absolute --output-dir ~/.cache/dsh-browser/output --output-max-size 268435456`) and spoken to over its stdio. It runs as the bot's user in the workspace, so file uploads and saved files are the VM's. Chrome is the desktop's service, so tabs and cookies outlive the server: when the server ends (killed, the SSH channel dropped), bot-core opens a new one at the next call and that call's result starts with a note that earlier element refs are gone; the earlier call is not repeated.

Everything the server answers is untrusted (the bot is root in the VM): lines are bounded (48 MiB), every message is checked (`src/host/mcp/protocol.ts`), images must be PNG, JPEG or WebP in base64 under 16 MiB before `images.admit`.

## Preparation

One idempotent path (`src/host/preparation.ts`): read the account → compare `/opt/dsh-browser/mcp/npm-shrinkwrap.json` with `vm/mcp/npm-shrinkwrap.json` and, if it differs (a VM installed with an earlier `package-lock.json` has none), run `vm/install-mcp.sh` (`npm ci --omit=dev --ignore-scripts`, then swap the directory in) → ask `http://127.0.0.1:9222/json/version` and require `Chrome/<version>` → start the server and require its `tools/list` to equal the generated tools exactly (names, descriptions, schemas, annotations). There is nothing to stop when it is turned off: bot-core closes the server; Chrome stays the desktop's.

The bot base image runs the same `vm/install-mcp.sh` with the same shrinkwrap (`infra/vm/build-base-image.sh`), so a new VM installs nothing; `test/base-image.test.ts` checks that.

## Tools

Generated, not written: `scripts/generate-tools.mjs` lists the tools of the pinned `@playwright/mcp` (`vm/mcp/package.json`, the same version as the devDependency) with `--caps vision,pdf --no-webmcp` and writes `src/generated/playwright-mcp.json`; it also refreshes `vm/mcp/npm-shrinkwrap.json` (a shrinkwrap rather than a `package-lock.json`, which `pnpm pack` leaves out; `npm ci` installs from either). To move to another version: change both versions, `pnpm install`, `pnpm --filter @1outres/dsh-bot-connector-browser generate`, `pnpm test`.

From that file (`src/host/catalog.ts`, `src/host/tools.ts`):

- every tool `browser_<x>` becomes the connector's `<x>` (bot-core names it `browser_<x>` again), with the upstream description;
- `browser_close` and `browser_install` are not offered (closing would close the person's Chrome; Chrome is the desktop's); `browser_run_code_unsafe` is **disallow** (arbitrary code in the server's process); all others **allow**;
- `readOnly` is the upstream `readOnlyHint` (snapshot, find, take_screenshot, console_messages, network_requests, network_request, pdf_save, wait_for): only those run while a person operates the desktop; every other tool fails with `USER_IN_CONTROL` (bot-core checks it from the desktop's status `operatedBy`);
- the schema is the upstream JSON Schema converted to DSH's subset (`src/host/schema.ts`: `$schema` and `propertyNames: string` dropped, `anyOf` with branches of different types as `oneOf`, `minimum`/`maximum` and typed `additionalProperties` moved into the description; an unknown keyword fails the build's tests). It only loosens: the server checks every call against its own schema;
- `maxResultChars` 128 000 (snapshots), `exclusive: "page"` (the server does not queue calls; one call per bot at a time), a call times out after 180 s.

| Tool                                                                                                                                                                                                                                                          | Default     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| browser_navigate / navigate_back / wait_for / snapshot / find / take_screenshot / console_messages / network_requests / network_request                                                                                                                       | allow       |
| browser_click / type / fill_form / press_key / select_option / hover / drag / handle_dialog / file_upload / drop / tabs / resize / emulate_media / evaluate / pdf_save / mouse_move_xy / mouse_click_xy / mouse_drag_xy / mouse_down / mouse_up / mouse_wheel | allow       |
| browser_run_code_unsafe                                                                                                                                                                                                                                       | disallow    |
| browser_close / browser_install                                                                                                                                                                                                                               | not offered |

Action results carry the page's snapshot as a file link (`~/.cache/dsh-browser/output/page-….yml`, readable with the bot's file tools); `browser_snapshot` returns it inline. Screenshots are images for the calling model; an approved action (a tool someone set to ask) has no caller, so its images are left out and the text says so.

Do not sign the bot's Chrome in to anyone's personal accounts: it would hand the account to the bot without any approval.

## Development

Tests run without a VM (`pnpm test`): a fake MCP server answers from the generated file.
