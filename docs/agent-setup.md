# Setting up dsh-bots (instructions for an agent)

You are setting up dsh-bots on the machine you run on, for the user you work with. dsh-bots
runs each bot of DeepSeek Harness (DSH) in its own Incus virtual machine. The installer does
the work; your job is to run it, fix what it reports, and ask the user for the decisions
below. Work in the user's account, not as root.

## Run the installer

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | DSH_BOTS_NONINTERACTIVE=1 bash
```

- It runs nine steps and prints one line per step. On failure it prints `error:` (what
  happened) and `fix:` (what to do), and the path of a log with the full output.
- It is safe to run again at any time and continues where it stopped. After each fix, run the
  same command again, until it prints `Done.`
- `DSH_BOTS_NONINTERACTIVE=1` keeps it from waiting on a terminal you cannot answer: where it
  would ask, it stops and names the variable to set.

## Ask the user first

Never decide these yourself. Explain in one or two sentences and wait for the answer.

| When                                                                         | Ask                                                                                            | Then                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the first run                                                         | Whether you may run commands with sudo                                                         | If sudo asks for a password, you cannot type it: ask the user to allow passwordless sudo for this setup, or to run the install command in their own terminal and paste you the output |
| It stops because Incus needs the Zabbly repository (Debian 12, Ubuntu 24.04) | Whether to add Zabbly, the Incus maintainers' third-party repository                           | Yes: run again with `DSH_BOTS_YES=1`                                                                                                                                                  |
| It stops because there are several DSH profiles                              | Which profile gets dsh-bots                                                                    | Run again with `DSH_BOTS_PROFILE=<name>`                                                                                                                                              |
| NixOS: it wrote `dsh-bots.nix` and stopped                                   | Whether you may add it to `imports` in their configuration and run `sudo nixos-rebuild switch` | Do it (or let them), then run again                                                                                                                                                   |
| It stops at DSH, Node.js or pnpm                                             | Whether to install or upgrade them as the fix line says                                        | Install them, then run again                                                                                                                                                          |
| `Done.` asks to restart DSH                                                  | Whether to restart DSH now                                                                     | If you run inside DSH, restarting ends your session: tell the user to restart it instead                                                                                              |

## Never

- Skip or work around a failed check (a missing `/dev/kvm`, another DSH version, an
  unsupported OS such as RHEL, Rocky or Alma). Report it with the installer's fix line.
- Weaken what isolates the bots: the network ACL, the bridge's firewall rules, the mount
  options of `~/.dsh/bots`, or the VMs' settings.
- Edit files the installer writes, or run `infra/vm/host-setup.sh` yourself.
- Change DSH profiles or plugins other than through the installer.

## Platforms

- Supported: x86_64 Linux with KVM — Debian 12 or 13, Ubuntu 24.04, Fedora 42+, Arch Linux,
  NixOS — also inside WSL2 on Windows 11.
- NixOS: DSH's Nix package carries its own Node.js, so `node` and `pnpm` may be missing from
  PATH. Run the installer inside `nix shell nixpkgs#nodejs_22 nixpkgs#pnpm -c bash -c '…'`, or
  ask the user to add `nodejs_22` and `pnpm` to `environment.systemPackages`.
- WSL2: systemd must be on (`/etc/wsl.conf`: `[boot]` `systemd=true`) and `/dev/kvm` present
  (nested virtualization, the default on Windows 11). WSL stops when idle and the bot VMs with
  it: tell the user about the line the installer prints at the end.

## When you finish

Tell the user in a few lines: what was installed or changed (packages, third-party
repository, DSH profile), what they still need to do (restart DSH, keep WSL running), and
where the log is (`~/.local/state/dsh-bots/logs/`). If you stopped, say at which step and why.
