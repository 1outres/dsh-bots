import type { BotConnectorImageInput, BotConnectorRun } from "@1outres/dsh-bot-core"
import { VAULT_KIT } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { GENERATED_SERVER } from "../src/host/catalog"
import { createBrowserConnector } from "../src/host/connector"
import { chromeVersion } from "../src/host/preparation"
import { imageOf, resultOf } from "../src/host/result"
import type { BrowserAttachment } from "../src/host/session"
import { readBrowserInstallation } from "../src/index"
import {
  ACCOUNT,
  CHROME_VERSION,
  deadline,
  fakeEnvironment,
  fakeProcess,
  playwrightAnswers,
} from "./support"

const PNG = Buffer.from("iVBORw0KGgo=", "base64").toString("base64")
const installation = await readBrowserInstallation()
const SHRINKWRAP = new TextDecoder().decode(installation.mcp.shrinkwrap)

const HELPERS = new Map(
  installation.helper.files.map((file) => [
    `cat -- /opt/dsh-browser/helper/${file.name}`,
    new TextDecoder().decode(file.data),
  ]),
)

function vm(
  options: {
    shrinkwrap?: string
    tools?: readonly unknown[]
    chrome?: string
    helpersMissing?: boolean
  } = {},
) {
  return fakeEnvironment(
    (command) => {
      const line = command.argv.join(" ")
      if (line.startsWith("sh -c id -u")) return { stdoutText: ACCOUNT }
      const helper = HELPERS.get(line)
      if (helper !== undefined) {
        return options.helpersMissing === true ? { exitCode: 1 } : { stdoutText: helper }
      }
      if (line === "cat -- /opt/dsh-browser/mcp/npm-shrinkwrap.json") {
        return { stdoutText: options.shrinkwrap ?? SHRINKWRAP }
      }
      if (line.startsWith("curl")) return { stdoutText: options.chrome ?? CHROME_VERSION }
      return {}
    },
    () =>
      fakeProcess(playwrightAnswers(options.tools === undefined ? {} : { tools: options.tools }))
        .process,
  )
}

const connector = () =>
  createBrowserConnector({
    generated: GENERATED_SERVER,
    installation,
    kit: VAULT_KIT,
    mark: () => "0".repeat(32),
    deadline,
  })

const context = (environment: ReturnType<typeof vm>["environment"]) => ({
  bot: { id: "b1", name: "Bot" },
  settings: {},
  environment,
  signal: new AbortController().signal,
})

describe("the browser connector", () => {
  it("requires the desktop, belongs to the workstation option and needs a VM with 3 GiB of memory", () => {
    expect(connector()).toMatchObject({
      id: "browser",
      sessions: "bot",
      requires: ["desktop"],
      creationOption: "workstation",
      minimumSpec: { memoryMiB: 3072 },
    })
    expect(connector().tools.every((tool) => tool.exclusive === "page")).toBe(true)
    expect(connector().tools.find((tool) => tool.name === "snapshot")?.readOnly).toBe(true)
    expect(connector().tools.find((tool) => tool.name === "click")?.readOnly).toBe(false)
  })
})

describe("preparing the browser", () => {
  it("checks Playwright MCP, the desktop's Chrome and the server's tools, installing nothing when the shrinkwrap matches", async () => {
    const machine = vm()
    const steps: string[] = []
    await connector().preparation?.prepare(context(machine.environment), (step) => steps.push(step))
    expect(steps).toEqual([
      "reading the bot's account",
      "checking Playwright MCP",
      "checking the login helpers",
      "checking the desktop's Chrome",
      "checking Playwright MCP's tools",
    ])
    expect(machine.commands.some((command) => command.argv.includes("sudo"))).toBe(false)
    expect(machine.spawned[0]?.argv.slice(0, 2)).toEqual([
      "node",
      "/opt/dsh-browser/mcp/node_modules/@playwright/mcp/cli.js",
    ])
  })

  it("installs the pinned tree with the image's script when the installed shrinkwrap differs", async () => {
    const machine = vm({ shrinkwrap: "{}" })
    const steps: string[] = []
    await connector().preparation?.prepare(context(machine.environment), (step) => steps.push(step))
    expect(steps).toContain(`installing Playwright MCP ${GENERATED_SERVER.version}`)
    expect([...machine.files.keys()]).toEqual([
      "/home/bot/.cache/dsh-browser/staging/package.json",
      "/home/bot/.cache/dsh-browser/staging/npm-shrinkwrap.json",
      "/home/bot/.cache/dsh-browser/staging/install-mcp.sh",
    ])
    expect(machine.commands.map((command) => command.argv.join(" "))).toContain(
      "sudo -n sh /home/bot/.cache/dsh-browser/staging/install-mcp.sh /home/bot/.cache/dsh-browser/staging /opt/dsh-browser/mcp",
    )
  })

  it("installs the login helpers as root with the image's script when one differs", async () => {
    const machine = vm({ helpersMissing: true })
    const steps: string[] = []
    await connector().preparation?.prepare(context(machine.environment), (step) => steps.push(step))
    expect(steps).toContain("installing the login helpers")
    const stage = "/home/bot/.cache/dsh-browser/helper-staging"
    expect([...machine.files.keys()]).toEqual([
      ...installation.helper.files.map((file) => `${stage}/${file.name}`),
      `${stage}/install-helper.sh`,
    ])
    expect(machine.commands.map((command) => command.argv.join(" "))).toContain(
      `sudo -n sh ${stage}/install-helper.sh ${stage} /opt/dsh-browser/helper`,
    )
  })

  it("fails when the server lists other tools than were generated, or DevTools is not Chrome's", async () => {
    const changed = vm({ tools: GENERATED_SERVER.tools.slice(1) })
    await expect(
      connector().preparation?.prepare(context(changed.environment), () => {}),
    ).rejects.toThrow(/lists other tools .*is missing/)
    const notChrome = vm({ chrome: JSON.stringify({ Browser: "Firefox/1" }) })
    await expect(
      connector().preparation?.prepare(context(notChrome.environment), () => {}),
    ).rejects.toThrow(/not Chrome's DevTools/)
    expect(chromeVersion(CHROME_VERSION)).toBe("Chrome/158.0.8127.88")
  })
})

function runOf(
  server: BrowserAttachment,
  admit: string | null = "ok",
): BotConnectorRun<BrowserAttachment> & { admitted: BotConnectorImageInput[] } {
  const admitted: BotConnectorImageInput[] = []
  return {
    admitted,
    bot: { id: "b1", name: "Bot" },
    settings: {},
    environment: vm().environment,
    signal: new AbortController().signal,
    trigger: { kind: "call" },
    attachment: server,
    ...(admit === null
      ? {}
      : {
          caller: {
            sessionId: "s1",
            images: {
              async admit(image) {
                admitted.push(image)
                return admit === "ok"
                  ? {
                      ok: true,
                      image: {
                        id: "img-1",
                        width: 10,
                        height: 10,
                        source: { width: 10, height: 10 },
                      },
                    }
                  : { ok: false, reason: admit }
              },
            },
          },
        }),
  }
}

describe("a browser tool", () => {
  it("calls the upstream tool and notes a reconnection once", async () => {
    const browser = connector()
    const machine = vm()
    const open = () => browser.attachment?.open(context(machine.environment))
    const first = await open()
    const navigate = browser.tools.find((tool) => tool.name === "navigate")
    if (first === undefined || navigate === undefined) throw new Error("no attachment")
    await expect(
      navigate.execute({ url: "https://example.com" }, runOf(first.value)),
    ).resolves.toEqual({
      text: "ran browser_navigate",
    })
    const second = await open()
    if (second === undefined) throw new Error("no attachment")
    const again = await navigate.execute({ url: "https://example.com" }, runOf(second.value))
    expect(again.text).toMatch(/^Note: the connection to the browser was opened again/)
    expect((await navigate.execute({ url: "x" }, runOf(second.value))).text).toBe(
      "ran browser_navigate",
    )
  })
})

describe("a Playwright MCP result", () => {
  it("returns the text and admits the images for the calling model", async () => {
    const server = {} as BrowserAttachment
    const run = runOf(server)
    const result = await resultOf(
      {
        content: [
          { type: "text", text: "### Result" },
          { type: "image", data: PNG, mimeType: "image/png" },
        ],
        isError: false,
      },
      run,
    )
    expect(result).toEqual({
      text: "### Result",
      images: [expect.objectContaining({ id: "img-1" })],
    })
    expect(run.admitted[0]?.mediaType).toBe("image/png")
  })

  it("fails with the server's error, a model without images, or a bad image", async () => {
    const server = {} as BrowserAttachment
    await expect(
      resultOf(
        { content: [{ type: "text", text: "### Error\nno page" }], isError: true },
        runOf(server),
      ),
    ).rejects.toThrow("no page")
    await expect(
      resultOf(
        { content: [{ type: "image", data: PNG, mimeType: "image/png" }], isError: false },
        runOf(server, "the model does not take images"),
      ),
    ).rejects.toThrow(/cannot show the image: the model does not take images/)
    expect(
      await resultOf(
        { content: [{ type: "image", data: PNG, mimeType: "image/png" }], isError: false },
        runOf(server, null),
      ),
    ).toEqual({ text: expect.stringMatching(/image was left out/) })
    expect(() => imageOf({ data: PNG, mimeType: "image/svg+xml" })).toThrow(/svg/)
    expect(() => imageOf({ data: "***", mimeType: "image/png" })).toThrow(/base64/)
  })
})
