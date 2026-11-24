# dsh-bots

Bots for [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh). Each bot runs in its own virtual machine with its own desktop and browser, talks with you in Discord, and can use your Gmail and Google Calendar, asking you before it sends or changes anything.

## Requirements

- Linux on x86_64 with KVM: Debian 12 or 13, Ubuntu 24.04, Fedora 42+, Arch Linux or NixOS, also in WSL2 on Windows 11
- DeepSeek Harness 0.2.2-rc.5, Node.js 22+ and pnpm

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash
```
