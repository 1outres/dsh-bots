import type { SetupBrief, SetupFailure, SetupFailureCode } from "@1outres/dsh-bot-core"
import type { SetupJob } from "./job"

export const BRIEF_FILE = "brief.md"
export const BRIEF_LOG_LINES = 80
export const BRIEF_SCRIPTS_DIR = "host-setup"
export const BRIEF_SSH_DIR = "ssh"

export type HostAccess =
  | { readonly kind: "this-machine" }
  | { readonly kind: "ssh"; readonly config: string; readonly alias: string }
  | { readonly kind: "ssh-without-key" }

export interface SetupBriefInput {
  readonly job: SetupJob
  readonly failure: SetupFailure
  readonly cwd: string
  readonly logTail: readonly string[]
  readonly logLines: number
  readonly bundleSha256: string
  readonly access: HostAccess
}

const FAILURE_HINTS: Readonly<Record<SetupFailureCode, string>> = {
  "not-root":
    "A root phase ran without root. The plugin runs every root phase under one sudo; look for why sudo did not take effect (sudoers, a wrapper around sudo).",
  "os-unsupported":
    "The OS cannot be a VM host. Check /etc/os-release against the supported VM hosts (Debian 12/13, Ubuntu 24.04, Fedora 42+; x86_64, KVM, systemd).",
  "third-party-refused":
    "This OS needs Incus from the Zabbly repository and the consent was not given. The person allows it with the consent switch in the settings.",
  "zabbly-key-mismatch":
    "The downloaded Zabbly signing key has an unexpected fingerprint. Check the network path to pkgs.zabbly.com (a proxy or a captive portal) before anything else; never accept another key.",
  "module-missing":
    "The kernel module vhost_vsock did not load. Check modinfo vhost_vsock and whether the running kernel matches the installed modules (a reboot after a kernel upgrade).",
  "incus-too-old":
    "The installed Incus is older than 6.0.4. Find where it came from (apt policy incus, dnf info incus) and how to upgrade it.",
  "no-vm-driver":
    "Incus cannot run VMs. Check /dev/kvm, the QEMU packages and journalctl -u incus for the qemu driver's error.",
  "project-conflict":
    "The Incus project exists with settings bot VMs cannot use (see what). Compare incus project show <project> with what the error names; choosing another project name is the safe way out.",
  "project-in-use":
    "The project holds instances or volumes another installation made (another user.dsh-bot.owner). Do not delete them unless the person confirms nothing uses them; another project name avoids the conflict.",
  "firewall-drops":
    "Another firewall's forward chain drops traffic (the chains are named in what). List the ruleset (nft list ruleset, iptables -S FORWARD, ufw status verbose, firewall-cmd --list-all) and find how that firewall allows forwarding from and to dshbr0.",
  "port-in-use":
    "Another program listens on the HTTPS port. ss -ltnp (with root) shows which; either free the port or choose another HTTPS port in the settings.",
  "token-missing":
    "Incus issued no trust token. Check incus config trust list-tokens and journalctl -u incus.",
  cancelled:
    "The setup was cancelled. Nothing needs fixing unless the person wants to know what it had done so far.",
  "command-failed":
    "A command in host-setup.sh failed. The command, the script and line, and the exit code are above; read that line in the scripts in this folder and the log lines just before the failure.",
  "sudo-rejected":
    "sudo did not accept the password, or asked for one again. Check that the user may use sudo on the VM host (sudo -l) and whether sudo prompts in an unusual way (requiretty, a PAM module). The plugin does not store the password: the person typed it for this attempt and types it again for the next one.",
  "ssh-failed":
    "SSH to the VM host failed. Check that the host is reachable, sshd runs, and the plugin's key is in the user's ~/.ssh/authorized_keys.",
  "host-key-changed":
    "The VM host's SSH host key differs from the pinned one. Do not accept the new key: the person checks the fingerprint on the VM host (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub) and scans it again in the settings.",
  "staging-failed":
    "Copying the setup scripts to the VM host failed. Check free space and permissions of the temporary directory (mktemp -d) and that tar and sha256sum exist there.",
  protocol:
    "host-setup.sh and the plugin disagreed about the event protocol. This is a bug or a changed script; collect the log lines around the failure for a report.",
  "endpoint-unreachable":
    "This machine cannot reach Incus' HTTPS port on the VM host. Check incus config get core.https_address on the VM host, the VM host's firewall, and a cloud security group between the two machines.",
  "pairing-failed":
    "Pairing with the trust token failed. Check the address and the server fingerprint in the log; running the setup again issues a new token.",
  "check-failed":
    "The VM host was paired, but its check found problems (see what). The Check group of the VM host in the settings shows each problem and its fix.",
  "image-failed":
    "Importing the base image failed. The VM host is usable once the image is imported; see the Base image group in the settings and the network path to GitHub Releases.",
  interrupted:
    "DSH stopped while the setup ran. If it stopped during packages, dpkg may need dpkg --configure -a on the VM host before running it again.",
}

const VM_HOST_LAYOUT = [
  "- Storage pool `dsh`: btrfs on a sparse loop file (/var/lib/incus/disks/dsh.img, 80 GiB max).",
  "- Network `dshbr0`: bridge 10.240.80.1/24 with DHCP and NAT, IPv6 disabled.",
  "- Network ACL `dsh-bot-egress` on dshbr0: egress to private, CGNAT, link-local and loopback ranges, the gateway and all IPv6 is rejected; other IPv4 is allowed; no ingress. Incus enforces it in its nft table `inet incus`.",
  "- Project (restricted, only dshbr0, other pools limited to 0) with `user.dsh-bots.pool`, `network` and `egress-acl` naming what the plugin uses.",
  "- Kernel module vhost_vsock (/etc/modules-load.d/dsh-bots.conf).",
  "- `core.https_address`: set only when unset (127.0.0.1:<port> on this machine, :<port> and the port opened in ufw / firewalld on another machine).",
  "- Firewall: with ufw, `ufw allow in on dshbr0` and route rules; with firewalld, dshbr0 in the trusted zone; with Docker's DOCKER-USER chain, dsh-bots-docker-forward.service. Another forward chain with policy drop stops the setup (firewall-drops).",
  "- Never enable Debian's nftables.service: its /etc/nftables.conf starts with `flush ruleset` and wipes Incus' tables.",
].join("\n")

function siteText(job: SetupJob): string {
  const { site } = job
  return site.kind === "this-machine"
    ? "this machine (the DSH host)"
    : `${site.user}@${site.host}:${site.port} over SSH`
}

function accessText(access: HostAccess): string {
  switch (access.kind) {
    case "this-machine":
      return "The VM host is this machine: run read-only commands here directly. Commands that need root are for the person to run (see below)."
    case "ssh":
      return [
        `Reach the VM host with \`ssh -F ${access.config} ${access.alias} <command>\` (one command per call; the key cannot open a pty or forward anything).`,
        "That config and its known_hosts are written for this session and pin the VM host's host key; use them as they are, and do not change ~/.ssh/config.",
      ].join(" ")
    case "ssh-without-key":
      return "The VM host was reached over SSH, but this installation's SSH key has been removed, so this session cannot reach it. Ask the person to run commands there and paste their output."
  }
}

const optional = (label: string, value: string | number | undefined) =>
  value === undefined ? [] : [`- ${label}: ${value}`]

export function setupBriefTitle(job: SetupJob, failure: SetupFailure): string {
  const where = job.site.kind === "this-machine" ? "this machine" : job.site.host
  return `VM host setup failed: ${failure.code} (${where})`
}

export function setupBriefMessage(input: SetupBriefInput): string {
  const { job, failure } = input
  return [
    "The managed setup of a dsh-bots VM host (Incus) failed. Find the cause and propose how to fix it.",
    "",
    "## Target",
    `- Site: ${siteText(job)}`,
    ...optional("OS", job.facts.os),
    ...optional("Incus", job.facts["incus-version"]),
    `- Incus project: ${job.target.project}`,
    `- HTTPS port: ${job.target.httpsPort}`,
    `- Attempt: ${job.attempt}`,
    "",
    "## Failure",
    `- Step: ${failure.step}`,
    `- Code: ${failure.code}`,
    `- What: ${failure.what}`,
    `- Suggested fix: ${failure.fix}`,
    ...optional("Command", failure.command),
    ...optional("Location", failure.location),
    ...optional("Exit code", failure.exitCode),
    "",
    `## Log (last ${input.logTail.length} of ${input.logLines} lines, secrets masked)`,
    "",
    "```",
    ...input.logTail,
    "```",
    "",
    `The whole log is ${input.cwd}/log.txt.`,
    "",
    "## Where to look",
    FAILURE_HINTS[failure.code],
    "",
    "## What the setup makes",
    VM_HOST_LAYOUT,
    "",
    `The setup scripts (host-setup.sh and the files it sources, bundle sha256 ${input.bundleSha256}) are in ${input.cwd}/${BRIEF_SCRIPTS_DIR}/; a Location such as host-setup.sh:120 refers to them. They are copies of this plugin's version: read them, do not run them.`,
    "",
    "## Access",
    accessText(input.access),
    "",
    "## Rules",
    "- The sudo password was not passed to this session. Do not ask for it. Commands that need root are for the person to run: give them the exact command and ask for its output.",
    "- Do not weaken the network ACL, the bridge's rules, the firewall rules for dshbr0 or the project's restrictions, and do not enable nftables.service.",
    "- Change nothing on the VM host without the person's agreement.",
    "- Once the cause is fixed, the person continues the setup with Try again in the dsh-bots settings (VM host); it continues where it stopped.",
  ].join("\n")
}

export function setupBriefOf(input: SetupBriefInput): SetupBrief {
  return {
    title: setupBriefTitle(input.job, input.failure),
    cwd: input.cwd,
    message: setupBriefMessage(input),
  }
}
