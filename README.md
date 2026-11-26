# dsh-bots

Bots for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh). Each bot runs in its own virtual machine with its own desktop and browser, talks with you in Discord, and can use your Gmail and Google Calendar, asking you before it sends or changes anything.

## Install

1. **In DSH** (DeepSeek Harness 0.2.2-rc.5 on any system it runs on, NixOS, Arch, WSL and macOS too, with OpenSSH's `ssh`): add `@1outres/dsh-bots` in DSH's **Plugins** screen, or

   ```sh
   dsh plugin --profile web add @1outres/dsh-bots@0.4.2
   ```

2. **A VM host** for the bots' VMs (x86_64 with KVM: Debian 13 or 12, Ubuntu 24.04 or Fedora 42+; the same machine as DSH or another one):

   ```sh
   curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash
   ```

   It asks whether DSH runs on that machine or on another one, and for another one prints a trust token.

3. In DSH: **dsh-bots settings** → **VM host** → **This machine**, or **Another machine** and paste the token.

An Incus server that already runs other things: its administrator creates a project for the bots instead (no root; see [the options](infra/incus/create-project.sh)):

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash -s -- incus-project --help
```

Or paste this to a coding agent (DeepSeek Harness, Claude Code, Codex, …):

```
Set up dsh-bots: follow https://raw.githubusercontent.com/1outres/dsh-bots/main/docs/agent-setup.md
```
