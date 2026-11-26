# dsh-bots

Bots for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh). Each bot runs in its own virtual machine with its own desktop and browser, talks with you in Discord, and can use your Gmail and Google Calendar, asking you before it sends or changes anything.

## Install

1. **In DSH** (DeepSeek Harness 0.2.2-rc.5 on any system it runs on, NixOS, Arch, WSL and macOS too, with OpenSSH's `ssh`): add `@1outres/dsh-bots` in DSH's **Plugins** screen, or

   ```sh
   dsh plugin --profile web add @1outres/dsh-bots@0.4.2
   ```

2. In DSH: **dsh-bots settings** → **VM host**, and choose where the bots' VMs run:
   - **Build on this machine** or **Build on another machine** (over SSH): x86_64 with KVM, Debian 13 or 12, Ubuntu 24.04 or Fedora 42+. The plugin installs and sets up Incus there itself; you enter the sudo password, or add its SSH key for another machine.
   - **Use an existing server**: paste the trust token its administrator gives you.

An Incus server that already runs other things: its administrator creates a project and a token for the bots instead (no root; see [the options](infra/incus/create-project.sh)):

```sh
curl -fsSL https://codeload.github.com/1outres/dsh-bots/tar.gz/v0.4.2 | tar -xz --strip-components=1 dsh-bots-0.4.2/infra
infra/incus/create-project.sh --help
```

Or paste this to a coding agent (DeepSeek Harness, Claude Code, Codex, …):

```
Set up dsh-bots: follow https://raw.githubusercontent.com/1outres/dsh-bots/main/docs/agent-setup.md
```
