import { describe, expect, it } from "vitest"
import { isCanonicalPath, userDataText } from "../src/host/cloud-init"
import { sshConfigText } from "../src/host/ssh-config"

const DEVICE = "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace"
const input = {
  workspaceDevice: DEVICE,
  user: "bot",
  workspace: "/home/bot/workspace",
  authorizedKey: "ssh-ed25519 AAAA bot",
  hostPrivateKey: "-----BEGIN-----\nkey\n-----END-----\n",
  hostPublicKey: "ssh-ed25519 BBBB host",
}

describe("userDataText", () => {
  it("is ASCII-only cloud-config with every value escaped", () => {
    const text = userDataText({ ...input, workspace: "/home/ü/ボット" })
    expect(/[^\t\n -~]/.test(text)).toBe(false)
    expect(text).toContain("\\u00fc")
    const document = JSON.parse(text.slice("#cloud-config\n".length))
    expect(document.runcmd[0].slice(-2)).toEqual(["/home/ü/ボット", "bot"])
    expect(document.ssh_genkeytypes).toEqual(["ed25519"])
  })

  it("mounts the workspace volume through fstab (made and grown by systemd), gives it to the user, then syncs", () => {
    const document = JSON.parse(userDataText(input).slice("#cloud-config\n".length))
    expect(document.bootcmd).toBeUndefined()
    expect(document.fs_setup).toBeUndefined()
    expect(document.mounts).toEqual([
      [
        DEVICE,
        "/home/bot/workspace",
        "ext4",
        "defaults,x-systemd.makefs,x-systemd.growfs,x-systemd.device-timeout=60s",
        "0",
        "2",
      ],
    ])
    expect(document.runcmd).toEqual([
      [
        "sh",
        "-c",
        'systemctl daemon-reload && systemctl start "$(systemd-escape --path --suffix=mount "$1")" && mountpoint -q "$1" && chown "$2:$2" "$1"',
        "sh",
        "/home/bot/workspace",
        "bot",
      ],
      ["sync"],
    ])
  })

  it("refuses a workspace that is not canonical", () => {
    for (const workspace of ["/a/../b", "/", "relative", "/a/"]) {
      expect(() => userDataText({ ...input, workspace })).toThrow("canonical")
    }
  })

  it("knows canonical paths", () => {
    expect(isCanonicalPath("/a/b")).toBe(true)
    for (const path of ["a", "/", "/a/", "/a/./b", "/a//b", "/a\nb"]) {
      expect(isCanonicalPath(path)).toBe(false)
    }
  })
})

describe("sshConfigText", () => {
  it("escapes % in token-expanding paths", () => {
    const text = sshConfigText({
      alias: "dsh-bot-x",
      proxyCommand: "p",
      user: "bot",
      identityFile: "/s/100%/key",
      knownHostsFile: "/s/100%/known_hosts",
    })
    expect(text).toContain("IdentityFile /s/100%%/key\n")
    expect(text).toContain("UserKnownHostsFile /s/100%%/known_hosts\n")
    expect(text).toContain("ProxyUseFdpass no\n")
  })
})
