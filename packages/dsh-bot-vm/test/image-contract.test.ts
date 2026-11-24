import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import * as vm from "../src/index"

const infra = join(import.meta.dirname, "../../../infra/vm")

describe("the base image and this package agree", () => {
  it("creates the guest user with the uid and gid the share maps", () => {
    const provision = readFileSync(join(infra, "provision-base.sh"), "utf8")
    const uid = Number(/^BOT_UID=(\d+)$/m.exec(provision)?.[1])
    const config = vm.Config({} as never)
    expect([config.guestUid, config.guestGid]).toEqual([uid, uid])
    expect(provision).toMatch(/useradd --uid "\$BOT_UID" --gid "\$BOT_UID"/)
  })

  it("starts its check VM with that uid too", () => {
    const check = readFileSync(join(infra, "check-vm.sh"), "utf8")
    expect(Number(/^GUEST_UID=(\d+)$/m.exec(check)?.[1])).toBe(vm.Config({} as never).guestUid)
  })
})
