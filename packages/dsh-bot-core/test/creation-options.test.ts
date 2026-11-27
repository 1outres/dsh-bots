import { describe, expect, it } from "vitest"
import {
  creationEnvironment,
  initialChoices,
  noChoices,
  offeredOptions,
  optionFits,
} from "../src/client/creation-options"
import type { BotCreationOffer } from "../src/shared/bots"

const capacity = (memoryMax: number) =>
  ({
    status: "ready",
    capacity: {
      cpus: { min: 1, max: 8, step: 1 },
      memoryMiB: { min: 1024, max: memoryMax, step: 512 },
      diskGiB: { min: 10, max: 100, step: 1, growOnly: true },
    },
  }) as const

const workstation = (memoryMax: number): BotCreationOffer => ({
  options: [
    {
      option: "workstation",
      needs: [
        { connector: "Desktop", minimum: { memoryMiB: 4096 } },
        { connector: "Browser", minimum: { memoryMiB: 3072 } },
      ],
    },
  ],
  capacity: capacity(memoryMax),
})

describe("the New bot dialog's creation options", () => {
  it("offers the workstation option on when a connector belongs to it and the Host can give it", () => {
    const offer = workstation(12288)
    expect(offeredOptions(offer)).toEqual(["workstation"])
    expect(optionFits(offer, "workstation")).toBe(true)
    expect(initialChoices(offer)).toEqual({ workstation: true })
    expect(creationEnvironment(offer, { workstation: true })).toEqual({
      status: "planned",
      ok: true,
      spec: { cpus: 4, memoryMiB: 6144, diskGiB: 20 },
    })
  })

  it("starts an option the Host cannot give off, and plans a smaller VM without it", () => {
    const offer = workstation(3072)
    expect(optionFits(offer, "workstation")).toBe(false)
    expect(initialChoices(offer)).toEqual({ workstation: false })
    expect(creationEnvironment(offer, { workstation: false })).toMatchObject({
      ok: true,
      spec: { memoryMiB: 3072 },
    })
    expect(creationEnvironment(offer, { workstation: true })).toMatchObject({
      ok: false,
      shortfalls: [{ key: "memoryMiB", connectors: ["Desktop"] }],
    })
  })

  it("plans no VM while the capacity cannot be read", () => {
    const offer: BotCreationOffer = {
      options: [],
      capacity: { status: "unavailable", reason: "Incus is down" },
    }
    expect(offeredOptions(offer)).toEqual([])
    expect(initialChoices(offer)).toEqual({ workstation: false })
    expect(creationEnvironment(offer, noChoices())).toEqual({
      status: "unavailable",
      reason: "Incus is down",
    })
  })

  it("plans no VM, and fits no option, while the Host has no room for another VM", () => {
    const reason =
      'the Incus project "bots" already has 3 VMs, as many as its limits.virtual-machines allows'
    const offer: BotCreationOffer = {
      ...workstation(12288),
      capacity: { status: "full", reason },
    }
    expect(optionFits(offer, "workstation")).toBe(false)
    expect(initialChoices(offer)).toEqual({ workstation: false })
    expect(creationEnvironment(offer, noChoices())).toEqual({ status: "full", reason })
  })
})
