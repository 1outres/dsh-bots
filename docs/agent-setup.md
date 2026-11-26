# Setting up dsh-bots (instructions for an agent)

dsh-bots runs each bot of DeepSeek Harness (DSH) in its own Incus virtual machine. There are
two machines, which may be the same one:

- **The DSH host**, where DSH runs (any system DSH runs on: Linux, NixOS, Arch, WSL, macOS). It
  only gets the plugin. No installer, no root.
- **The VM host**, where the bots' VMs run: x86_64 with KVM, Debian 13 or 12, Ubuntu 24.04 or
  Fedora 42+. Its installer needs root (sudo).

Find out from the user which machine you run on and where the other one is. Work in the
user's account, not as root. Do what belongs to the machine you run on; for the other one,
tell the user the one command to run there (or that an agent there should follow this file).

## On the DSH host: add the plugin

Use DSH's own way of adding plugins. Inside DSH use its plugin manager (install the bundle
`@1outres/dsh-bots` of the version the README names); from a shell:

```sh
dsh plugin --profile <profile> add @1outres/dsh-bots@<version>
```

`<profile>` is a directory under `~/.dsh/profiles` (`web` for the Web UI); ask when there are
several. The plugin needs DSH at exactly the version the README names and OpenSSH's `ssh` on
PATH. DSH loads it on its next start (the plugin manager says whether a restart is needed).

## On the VM host: run the installer

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | DSH_BOTS_NONINTERACTIVE=1 DSH_BOTS_ACCESS=<local|remote> bash
```

- `DSH_BOTS_ACCESS=local` when DSH runs on this same machine (run it as the user that runs
  DSH: it joins that user to `incus-admin`); `remote` when DSH runs on another machine (it opens
  Incus' HTTPS API, port 8443, and prints a trust token at the end).
- It runs six steps and prints one line per step. On failure it prints `error:` (what
  happened) and `fix:` (what to do), and the path of a log with the full output.
- It is safe to run again at any time and continues where it stopped. After each fix, run the
  same command again, until it prints `Done.`
- `DSH_BOTS_NONINTERACTIVE=1` keeps it from waiting on a terminal you cannot answer: where it
  would ask, it stops and names the variable to set.

## Then: choose the VM host in DSH

In DSH's Web UI: **dsh-bots settings** → **VM host**:

- **This machine** (local): nothing to enter. If the installer added the user to `incus-admin`,
  DSH must be restarted first (and the user log in again when DSH is started from a shell).
- **Another machine** (remote): paste the trust token, check that the server certificate
  shown matches the VM host's (`incus info | grep certificate_fingerprint` there), pick the
  address DSH reaches it at, and pair. A token pairs one DSH, once; a new run of the
  installer replaces an unused one.

The section then checks the VM host, and **Base image** imports the bots' image (about
1.4 GiB, downloaded by DSH). A problem shows its fix there.

## An Incus server that runs other things

Do not run the installer there. Its administrator creates a project for the bots and a
token (no root; `--help` lists the options: pool, network or a new bridge, ACL, limits):

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash -s -- incus-project --help
```

Then pair as for another machine.

## Ask the user first

Never decide these yourself. Explain in one or two sentences and wait for the answer.

| When                                                                         | Ask                                                                  | Then                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before anything                                                              | Where DSH runs and where the bots' VMs should run                    | The same machine: `DSH_BOTS_ACCESS=local` there. Another one: `remote` on the VM host, the plugin on the DSH host                                                                     |
| Before running the installer                                                 | Whether you may run commands with sudo on the VM host                | If sudo asks for a password, you cannot type it: ask the user to allow passwordless sudo for this setup, or to run the install command in their own terminal and paste you the output |
| It stops because Incus needs the Zabbly repository (Debian 12, Ubuntu 24.04) | Whether to add Zabbly, the Incus maintainers' third-party repository | Yes: run again with `DSH_BOTS_YES=1`                                                                                                                                                  |
| Remote: before opening the HTTPS API                                         | Whether port 8443 of the VM host may be reachable from the DSH host  | The installer opens it in ufw and firewalld; other firewalls (a cloud's security group) are the user's                                                                                |
| DSH needs a restart (the plugin, or the `incus-admin` group)                 | Whether to restart DSH now                                           | If you run inside DSH, restarting ends your session: tell the user to restart it instead                                                                                              |

## Never

- Skip or work around a failed check (a missing `/dev/kvm`, another DSH version, a system that
  cannot be a VM host such as NixOS, Arch, WSL, RHEL, Rocky or Alma). Report it with the
  installer's fix line; such a machine can still be the DSH host.
- Weaken what isolates the bots: the network ACL, the bridge's firewall rules, the project's
  restrictions, or the VMs' settings.
- Paste a trust token anywhere but the dsh-bots settings, or keep it in a file.
- Edit files the installer writes, or run `infra/vm/host-setup.sh` yourself.

## When you finish

Tell the user in a few lines: what was installed or changed (packages, third-party
repository, the HTTPS API and its port, the plugin and its DSH profile), what they still need
to do (restart DSH, pair, import the base image), and where the installer's log is
(`~/.local/state/dsh-bots/logs/` on the VM host). If you stopped, say at which step and why.
