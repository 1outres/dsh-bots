# @1outres/dsh-bot-connector-desktop

A bot-core connector (`desktop`) that gives each bot a desktop in its own VM — XFCE on Xvnc with LibreOffice, Google Chrome, a terminal and a file manager — which the bot reads through the accessibility tree (AT-SPI) and operates with keyboard and mouse, and which a person watches and takes over in the bot's window (the **Desktop** panel). Row id `bot-connector-desktop`. A Host part and a Client part; it needs `@1outres/dsh-bot-core` and a bot environment (`@1outres/dsh-bot-vm`).

It is off for every bot until a person enables it (`bot.configureConnector(botId, "desktop", { enabled: true, values: { resolution } })`, Remote `botConnectors.configure`). It needs a bot whose VM spec has 4 GiB of memory or more (`minimumSpec`; bot-core refuses the switch otherwise, and new bots get 6 GiB); then bot-core runs the preparation, shown as `preparing` steps.

## What runs where

- **Host**: the connector definition and a thin client. It reaches the VM only through bot-core's environment access (`exec`, `spawn`, `writeFile` as the bot user, `sudo -n` where root is needed); it never calls Incus or opens SSH itself.
- **VM** (bot user's systemd user services, linger): `dsh-desktop-xvnc` (Xvnc :1, RFB only on `$XDG_RUNTIME_DIR/dsh-desktop/vnc.sock` 0600, a fresh X cookie in `…/Xauthority` each start), `dsh-desktop-session` (XFCE), `dsh-desktop-agent` (`vm/agent/`: Python + pyatspi, newline-delimited JSON-RPC on `$XDG_RUNTIME_DIR/dsh-desktop-agent/agent.sock` 0600), `dsh-desktop-im` (fcitx5-mozc, for people typing Japanese on the screen later) and `dsh-desktop-chrome` (the screen's browser, below).

## Google Chrome

The desktop's browser is Google Chrome from Google's apt source (`vm/apt/`: the key, primary fingerprint `EB4C 1BFD 4F04 2F6D DDCC EC91 7721 F63B D38B 4796`, and a source of its own, `dsh-google-chrome.sources` on `dl.google.com/linux/chrome/deb`; the package then keeps its own `google-chrome.sources` on `chrome-stable/deb` with its own key, and the two never write the same file). There is **one Chrome per VM**: the user service `dsh-desktop-chrome` (`vm/bin/chrome-run`: its own profile `~/.local/share/dsh-desktop/chrome`, DevTools on `127.0.0.1:9222` — Chrome binds it to loopback and refuses it on the default profile since 136 —, `--force-renderer-accessibility` so the page content is in `desktop_tree`), enabled with the session, `Restart=always`, ready once DevTools answers (`vm/bin/chrome-ready`). `/usr/bin/google-chrome-stable` is replaced (`dpkg-divert`, the package's file kept as `.dsh-real`) by `vm/bin/google-chrome-stable`, which starts that service and opens its arguments in it, so the menu, `xdg-open`, `x-www-browser`, exo and `desktop_launch chrome` all open in the same Chrome. The browser connector (`@1outres/dsh-bot-connector-browser`) drives this Chrome over DevTools; it requires this connector.

The agent runs where the bot is root, so the Host treats every answer as untrusted: each method's result is checked against its shape and limits (`src/host/agent/protocol.ts`), screenshots are checked for format, size and length before `images.admit`.

## Preparation

One idempotent path (`src/host/vm/preparation.ts`): read the account → write `vm/` to its places (`src/host/vm/files.ts`, Google's source among them, after diverting `/usr/bin/google-chrome-stable`) and `/etc/dsh-desktop/display.env` → install the package list (`debian-packages.txt`, one name per line) when any is missing → enable linger, `daemon-reload`, enable the units → restart Xvnc if it runs at another size or `xvnc-start` changed → start the session, restart the agent → restart Chrome if `chrome-run` or its unit changed, start it → check `xdpyinfo` and the agent's `status`. Turning the connector off disables and stops the units; packages and data stay.

The bot base image (`infra/vm/build-base-image.sh`) installs the same `debian-packages.txt`, so on a VM made from a current image the package step finds everything installed and downloads nothing; the step still runs, and installs whatever an older image or a changed list lacks. `test/base-image.test.ts` checks that the image build reads this file. After changing the list, rebuild the image.

## Settings

| Key          | Kind   | Default     | Options                 |
| ------------ | ------ | ----------- | ----------------------- |
| `resolution` | choice | `1280x1024` | `1280x1024`, `1280x800` |

Changing it restarts the desktop session (open applications close).

## Tools

All `allow`, every session of the bot; all but `desktop_request_handoff` are `exclusive: "display"` (one call at a time per bot, from any session).

| Tool                                                                     | What it does                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `desktop_tree`                                                           | The active window (or a window/element) as lines `[id] role "name" text=… states`; start here     |
| `desktop_find`                                                           | Elements by role, name, text, states                                                              |
| `desktop_act`                                                            | press, focus, set_text, set_value, select, click, activate, scroll_into_view; answers the changes |
| `desktop_text`                                                           | The whole text of an element                                                                      |
| `desktop_sheet`                                                          | LibreOffice Calc: read the non-empty cells, write a block of values                               |
| `desktop_windows` / `desktop_focus_window` / `desktop_launch`            | Windows with ids; raise one; start writer, calc, impress, chrome, terminal, files                 |
| `desktop_type` / `desktop_key` / `desktop_hold_key`                      | Keyboard; non-ASCII text is pasted through the clipboard                                          |
| `desktop_click` / `move` / `drag` / `mouse_down` / `mouse_up` / `scroll` | Mouse at the latest screenshot's coordinates or an element's centre                               |
| `desktop_cursor_position`, `desktop_clipboard_get` / `_set`              |                                                                                                   |
| `desktop_screenshot`                                                     | The screen, the active window, an element, or a zoomed region; the last resort                    |
| `desktop_request_handoff`                                                | Ask the person to take over (log in, a password, a code) and wait until they hand it back         |

Coordinates refer to the latest screenshot's image as the model received it; before one, after a reconnection or a screen size change, pointer calls fail with `SCREENSHOT_REQUIRED`. Where accessibility cannot do something (Chrome's fields have no editable text, XFCE panel menus do not open with press, Calc cells must not be selected), the error says what to do instead; there is no silent substitute.

## Who operates the desktop

`DesktopControl` (`src/host/control.ts`, state only) holds per bot whether the agent or one viewer of the screen (one panel stream) has the input, and the bot's open request that a person take over. While a person does, tools that change the screen fail with `USER_IN_CONTROL`; reading tools still work. The first result after the agent gets it back (and after a reconnection) starts with a note to look again. When the viewer holding the input goes away (its tab closes, its connection drops, the connector leaves ready) the agent has it back; a reconnected viewer takes it again. The control is the connector's `status` for bot-core: a note and `operatedBy: "person"` while a person operates (bot-core then runs only the reading tools of connectors that require the desktop, such as the browser's), and the request.

`desktop_request_handoff(reason, wait_minutes?)` (default 10, at most 30) puts the request up and waits: it answers once the person took over and handed back (or their viewer closed), turned it down, or the wait ran out; a stopped turn ends the wait; the request goes in every case. One request per bot at a time (`HANDOFF_PENDING`). People see it in the bot's window only (a band above the conversation of every session of the bot, a dot on the Desktop button, Take over / Decline in the panel); channels do not get it.

## The screen and the Desktop panel

- **Relay** (`src/host/screen/`): the panel's `screen` stream (bot-core's `botConnectorStreams`, owner only, while the desktop is ready) starts `socat -b65536 - UNIX-CONNECT:$XDG_RUNTIME_DIR/dsh-desktop/vnc.sock` in the VM through bot-core's environment and relays RFB as base64 items (`src/shared/screen.ts`): down `rfb` and `control` (who holds the input, the request), up `rfb` (at most 192 KiB of base64), `take`, `release`, `decline`. The screen is read only when the Gateway asks for the next item, so a slow browser holds Xvnc back.
- **RFB filter** (`src/host/screen/rfb-filter.ts`): frames the viewer's RFB 3.8 messages; picture requests always pass, input (keys, pointer, clipboard, desktop size, xvp, QEMU keys) only from the viewer in control; another version, a security type other than None, an unknown message or clipboard text over 128 KiB fails the stream. ClientInit is made shared and ExtendedMouseButtons is taken out of SetEncodings. Keys and buttons a viewer held are released when it loses control.
- **Panel** (`src/client/`): noVNC 1.7 in bot-core's `bot-core.connector.panel` Slot (key `desktop`), view only until **Take over**; **Hand back**, **Send Ctrl+Alt+Del**, **Reconnect**. While you operate, it says that what you type (passwords included) reaches the bot's VM. A broken stream reopens after 2 s, doubling to 30 s; while the page is hidden and you do not hold the input, it closes the stream. The build defers noVNC's top-level H.264 probe (`scripts/build-options.mjs`) and fails if that line changes.
- Xvnc runs at `-FrameRate 24`; the preparation restarts it when `xvnc-start` changed.

## Development

`vm/` is installed as it is; `test/files.test.ts` checks every file there has a place. Tests run without a VM (`pnpm test`).
