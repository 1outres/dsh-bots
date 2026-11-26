# Setting up dsh-bots (instructions for an agent)

dsh-bots runs each bot of DeepSeek Harness (DSH) in its own Incus virtual machine. There are
two machines, which may be the same one:

- **The DSH host**, where DSH runs (any system DSH runs on: Linux, NixOS, Arch, WSL, macOS). It
  gets the plugin. No installer, no root.
- **The VM host**, where the bots' VMs run: x86_64 with KVM, Debian 13 or 12, Ubuntu 24.04 or
  Fedora 42+. The plugin builds it from its settings screen (packages, Incus, firewall, the
  connection), with root through sudo on that machine.

There is no install script to run. Find out from the user where DSH runs and where the bots'
VMs should run. Work in the user's account, not as root.

## On the DSH host: add the plugin

Use DSH's own way of adding plugins. Inside DSH use its plugin manager (install the bundle
`@1outres/dsh-bots` of the version the README names); from a shell:

```sh
dsh plugin --profile <profile> add @1outres/dsh-bots@<version>
```

`<profile>` is a directory under `~/.dsh/profiles` (`web` for the Web UI); ask when there are
several. The plugin needs DSH at exactly the version the README names and OpenSSH's client
(`ssh`, `ssh-keygen`, `ssh-keyscan`) on PATH. DSH loads it on its next start (the plugin
manager says whether a restart is needed).

## Then: the user chooses the VM host in DSH

In DSH's Web UI: **dsh-bots settings** → **VM host**. These steps are the user's: tell them
what to choose and what each step asks; never type a sudo password or a token for them.

- **Build on this machine**: the plugin checks the machine without root, then the user enters
  the sudo password in the screen (asked only when sudo needs one) and, on Debian 12 and
  Ubuntu 24.04, allows the Zabbly repository. Incus' HTTPS API listens on `127.0.0.1` only.
- **Build on another machine**: the user enters `user@host` (root, or a user that may use
  sudo), adds the line the screen shows to that user's `~/.ssh/authorized_keys` on the VM host,
  and trusts the host key only if `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` there
  prints the same fingerprint. Then as for this machine. The DSH host must reach the VM host's
  HTTPS port (8443 by default); the build opens it in ufw and firewalld, other firewalls (a
  cloud's security group) are the user's.
- **Use an existing server**: paste the trust token from the server's administrator (below).

The build shows its steps (Packages, Incus, Firewall, Connection, Base image); it is safe to
run again and continues where it stopped. Once it is done the section checks the VM host and
**Base image** shows the bots' image (about 1.4 GiB, downloaded by DSH). A problem shows its
fix there.

## When the build fails

The failure names the step, what happened and how to fix it. **Investigate in a session** opens
a DSH session that has the failure, the end of the log and what you may do on the VM host; work
from there. Commands that need root are the user's to run. After a fix, the user presses **Try
again** in the settings.

## An Incus server that runs other things

Do not build on it. Its administrator creates a project for the bots and a token (no root;
`--help` lists the options: pool, network or a new bridge, ACL, limits), from the source of the
release the plugin is (the settings' **Use an existing server** shows the same command for the
installed version):

```sh
curl -fsSL https://codeload.github.com/1outres/dsh-bots/tar.gz/v<version> | tar -xz --strip-components=1 dsh-bots-<version>/infra
infra/incus/create-project.sh --help
```

Then the user pastes the token in **Use an existing server**.

## Ask the user first

Never decide these yourself. Explain in one or two sentences and wait for the answer.

| When                              | Ask                                                                       | Then                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Before anything                   | Where DSH runs and where the bots' VMs should run                         | The same machine: **Build on this machine**. Another one: **Build on another machine**   |
| Before the build                  | Whether the plugin may install packages and set up Incus there with root  | The user enters the sudo password in the screen                                          |
| Debian 12, Ubuntu 24.04           | Whether to add Zabbly, the Incus maintainers' third-party repository      | The user turns on **Add the Zabbly repository**                                          |
| Another machine: before the build | Whether the VM host's HTTPS port may be reachable from the DSH host       | The build opens it in ufw and firewalld; other firewalls are the user's                  |
| Another machine: after the build  | Whether to keep the plugin's SSH key on the VM host (repairs and updates) | **SSH key after building**: Keep or Remove                                               |
| DSH needs a restart (the plugin)  | Whether to restart DSH now                                                | If you run inside DSH, restarting ends your session: tell the user to restart it instead |

## Never

- Skip or work around a failed check (a missing `/dev/kvm`, another DSH version, a system that
  cannot be a VM host such as NixOS, Arch, WSL, RHEL, Rocky or Alma). Report it with its fix;
  such a machine can still be the DSH host, with the VM host built on another machine.
- Weaken what isolates the bots: the network ACL, the bridge's firewall rules, the project's
  restrictions, or the VMs' settings.
- Ask for, read or keep the sudo password or a trust token; they go only into the dsh-bots
  settings.
- Edit files the build writes, or change `~/.ssh/config` for the plugin (it uses its own SSH
  config).

## When you finish

Tell the user in a few lines: what was added (the plugin and its DSH profile), what the build
changed (shown in its steps), what they still need to do (restart DSH, build or pair, the base
image), and, if it stopped, at which step and why.
