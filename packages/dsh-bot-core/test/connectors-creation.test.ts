import { describe, expect, it } from "vitest"
import type { BotConnector } from "../src/connector-contract"
import { createConnectorCatalog } from "../src/host/connectors/catalog"
import { createCreationConnectors } from "../src/host/connectors/creation"
import { type SettingsRecord, settingsRecordKey } from "../src/host/connectors/domain"
import { descriptorOf } from "../src/host/connectors/panel"
import { createConnectorSettings } from "../src/host/connectors/settings"
import { createSaveQueue } from "../src/host/save-queue"
import { type BotEnvironmentSpec, DEFAULT_BOT_ENVIRONMENT_SPEC } from "../src/shared/environment"
import { memoryTable } from "./channels-support"
import { mailConnector } from "./connectors-support"

const desk: BotConnector = {
  ...mailConnector(),
  id: "desk",
  name: "Desk",
  sessions: "bot",
  creationOption: "workstation",
  minimumSpec: { memoryMiB: 4096 },
  settings: [
    {
      kind: "choice",
      agent: { note: "Test setting.", change: "free" },
      key: "size",
      label: { en: "Size" },
      options: [
        { value: "large", label: { en: "Large" } },
        { value: "small", label: { en: "Small" } },
      ],
      default: "large",
    },
  ],
  preparation: { async prepare() {}, hint: { en: "Slow the first time.", ja: "初回は遅い。" } },
}

const web: BotConnector = {
  ...desk,
  id: "web",
  name: "Web",
  minimumSpec: { memoryMiB: 3072 },
  settings: [],
}

function setup(
  connectors: readonly BotConnector[] = [desk, web, mailConnector()],
  spec: BotEnvironmentSpec = DEFAULT_BOT_ENVIRONMENT_SPEC,
) {
  const catalog = createConnectorCatalog()
  for (const connector of connectors) catalog.register(connector)
  const records = memoryTable<SettingsRecord>()
  const settings = createConnectorSettings({
    records,
    catalog,
    queue: createSaveQueue(),
    spec: () => spec,
    now: () => 7,
  })
  return { catalog, settings, records, creation: createCreationConnectors({ catalog, settings }) }
}

describe("connectors of creation options", () => {
  it("offers an option while a registered connector belongs to it", () => {
    expect(setup().creation.offer()).toEqual([
      {
        option: "workstation",
        needs: [
          { connector: "Desk", minimum: { memoryMiB: 4096 } },
          { connector: "Web", minimum: { memoryMiB: 3072 } },
        ],
      },
    ])
    expect(setup([mailConnector()]).creation.offer()).toEqual([])
    expect(setup([]).creation.offer()).toEqual([])
  })

  it("selects every registered connector of an option on, and none for an option off", () => {
    const { creation } = setup()
    expect(creation.select({ workstation: true }).map((connector) => connector.id)).toEqual([
      "desk",
      "web",
    ])
    expect(creation.select({ workstation: false })).toEqual([])
  })

  it("refuses an option on that no registered connector belongs to, and malformed choices", () => {
    const { creation } = setup([mailConnector()])
    expect(() => creation.select({ workstation: true })).toThrow(
      "no registered connector offers the workstation option",
    )
    expect(creation.select({ workstation: false })).toEqual([])
    expect(() => creation.select({})).toThrow("workstation must be true or false")
    expect(() => creation.select({ workstation: "yes" })).toThrow(
      "workstation must be true or false",
    )
    expect(() => creation.select(undefined)).toThrow("the creation is missing")
  })

  it("enables the selected connectors with their default settings, the others staying off", async () => {
    const { creation, settings, catalog } = setup()
    await creation.enable("b1", creation.select({ workstation: true }))
    const [deskEntry, webEntry, mailEntry] = catalog.list()
    if (deskEntry === undefined || webEntry === undefined || mailEntry === undefined) {
      throw new Error("not registered")
    }
    expect(settings.view("b1", deskEntry)).toEqual({ enabled: true, values: { size: "large" } })
    expect(settings.view("b1", webEntry)).toEqual({ enabled: true, values: {} })
    expect(settings.view("b1", mailEntry)).toEqual({ enabled: false, values: {} })
    await creation.enable("b2", creation.select({ workstation: false }))
    expect(settings.view("b2", deskEntry).enabled).toBe(false)
  })

  it("enables a connector of an option after the ones of it it requires", async () => {
    const browser: BotConnector = { ...web, requires: ["desk"] }
    const { creation, records } = setup([browser, desk])
    await creation.enable("b1", creation.select({ workstation: true }))
    expect(
      [...records.entries()].map(([, record]) => [record.connectorId, record.enabled]),
    ).toEqual([
      ["desk", true],
      ["web", true],
    ])
  })

  it("creates no bot whose spec gives an option's connector too little memory", async () => {
    const { creation, records } = setup(undefined, { cpus: 4, memoryMiB: 3072, diskGiB: 20 })
    await expect(creation.enable("b1", creation.select({ workstation: true }))).rejects.toThrow(
      "Desk needs 4 GiB of memory or more",
    )
    expect([...records.entries()]).toEqual([])
  })

  it("creates no bot with a connector whose requirement no option turns on", async () => {
    const browser: BotConnector = { ...web, requires: ["desk"] }
    const loneDesk: BotConnector = { ...mailConnector(), id: "desk", name: "Desk", sessions: "bot" }
    const { creation, records } = setup([browser, loneDesk])
    await expect(creation.enable("b1", creation.select({ workstation: true }))).rejects.toThrow(
      "turn on Desk first: Web needs it",
    )
    expect([...records.entries()]).toEqual([])
  })

  it("keeps none of a new bot's connectors when one cannot be stored", async () => {
    const { creation, records } = setup()
    const put = records.put
    let writes = 0
    records.put = async (key, value) => {
      writes += 1
      if (writes === 3) throw new Error("disk full")
      await put(key, value)
    }
    await creation.enable("b0", creation.select({ workstation: true }))
    await expect(creation.enable("b1", creation.select({ workstation: true }))).rejects.toThrow(
      "disk full",
    )
    expect([...records.entries()].map(([key]) => key)).toEqual([
      settingsRecordKey("b0", "desk"),
      settingsRecordKey("b0", "web"),
    ])
  })

  it("refuses a connector whose creation option or preparation hint is malformed", () => {
    const catalog = createConnectorCatalog()
    expect(() =>
      catalog.register({ ...desk, id: "bad", creationOption: "desktop" as never }),
    ).toThrow("creationOption that is not one of workstation")
    expect(() =>
      catalog.register({
        ...desk,
        id: "worse",
        preparation: { async prepare() {}, hint: { en: " " } },
      }),
    ).toThrow("hint")
    expect(descriptorOf(desk).preparation).toEqual({ hint: desk.preparation?.hint })
    expect(descriptorOf(mailConnector()).preparation).toBeUndefined()
  })
})
