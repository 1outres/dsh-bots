const MARKER = ".cache/dsh-connector-probe/prepared"

const text = (bytes) => new TextDecoder().decode(bytes)
const utf8 = (value) => new TextEncoder().encode(value)
const home = (environment) => environment.workspace.replace(/\/workspace$/, "")

async function run(environment, argv, options = {}) {
  const result = await environment.exec({
    argv,
    timeoutMs: 30_000,
    maxOutputBytes: 1 << 20,
    ...options,
  })
  if (result.exitCode !== 0)
    throw new Error(`${argv[0]} exited ${result.exitCode}: ${result.stderr.trim()}`)
  return result
}

const PNG = [
  "import struct, sys, zlib",
  "w, h = 320, 200",
  "rows = b''.join(b'\\x00' + bytes(v for x in range(w) for v in (x * 255 // w, y * 255 // h, 128)) for y in range(h))",
  "def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)",
  "sys.stdout.buffer.write(b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))",
].join("\n")

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

const probe = (record, minMemoryMiB) => ({
  id: "probe",
  name: "Probe",
  description: {
    en: "Verification connector that drives the bot's VM.",
    ja: "VM を操作する検証用コネクター",
  },
  sessions: "bot",
  settings: [
    { key: "greeting", kind: "text", label: { en: "Greeting" }, default: "hello", maxLength: 40 },
    { key: "slow", kind: "toggle", label: { en: "Slow preparation" }, default: false },
    { key: "fail", kind: "toggle", label: { en: "Fail preparation" }, default: false },
  ],
  ...(minMemoryMiB === undefined ? {} : { minimumSpec: { memoryMiB: minMemoryMiB } }),
  preparation: {
    async prepare(context, progress) {
      progress("writing the marker")
      record({ op: "prepare", botId: context.bot.id, settings: context.settings })
      if (context.settings.slow) {
        progress("waiting (slow)")
        await sleep(8_000, context.signal)
      }
      if (context.settings.fail) throw new Error("the probe was told to fail its preparation")
      await run(context.environment, [
        "mkdir",
        "-p",
        `${home(context.environment)}/.cache/dsh-connector-probe`,
      ])
      await context.environment.writeFile(
        `${home(context.environment)}/${MARKER}`,
        utf8(`prepared ${new Date().toISOString()} greeting=${context.settings.greeting}\n`),
        { mode: 0o600 },
      )
      progress("checking")
      await run(context.environment, ["test", "-s", `${home(context.environment)}/${MARKER}`])
    },
    async unprepare(context) {
      record({ op: "unprepare", botId: context.bot.id })
      await run(context.environment, ["rm", "-f", `${home(context.environment)}/${MARKER}`])
    },
  },
  attachment: {
    async open(context) {
      const process = await context.environment.spawn({ argv: ["cat"], signal: context.signal })
      const reader = process.stdout[Symbol.asyncIterator]()
      record({ op: "attach", botId: context.bot.id })
      return {
        value: {
          async roundtrip(value) {
            await process.stdin.write(utf8(`${value}\n`))
            const next = await reader.next()
            return next.done ? "" : text(next.value).trim()
          },
        },
        ended: process.done,
        async dispose() {
          record({ op: "detach", botId: context.bot.id })
          process.terminate()
        },
      }
    },
  },
  tools: [
    {
      name: "echo",
      description: "Echo a text back (verification tool).",
      parameters: { text: { type: "string", required: true } },
      permission: "allow",
      preview: (args) => ({ title: `Echo "${args.text}"?`, fields: [] }),
      async execute(args, run) {
        record({
          op: "executed",
          tool: "echo",
          args,
          trigger: run.trigger,
          caller: run.caller?.sessionId,
        })
        return { text: `${run.settings.greeting}: ${args.text}` }
      },
    },
    {
      name: "exec",
      description:
        "Run uname, id and read the preparation marker in the bot's VM (verification tool).",
      parameters: {},
      permission: "allow",
      exclusive: "vm",
      preview: () => ({ title: "Run a command in the VM?", fields: [] }),
      async execute(_args, context) {
        const result = await run(context.environment, [
          "sh",
          "-c",
          `uname -a; id -un; cat "$HOME/${MARKER}"; sleep 2`,
        ])
        record({ op: "executed", tool: "exec", caller: context.caller?.sessionId })
        return { text: text(result.stdout) }
      },
    },
    {
      name: "screenshot",
      description: "Draw a 320x200 test image in the bot's VM and show it (verification tool).",
      parameters: {},
      permission: "allow",
      preview: () => ({ title: "Draw a test image?", fields: [] }),
      async execute(_args, context) {
        const result = await run(context.environment, ["python3", "-I", "-c", PNG])
        const admitted = await context.caller?.images.admit({
          mediaType: "image/png",
          data: result.stdout,
          name: "probe.png",
        })
        record({ op: "executed", tool: "screenshot", bytes: result.stdout.byteLength, admitted })
        if (admitted === undefined || !admitted.ok) {
          throw new Error(
            `the image cannot be shown: ${admitted?.ok === false ? admitted.reason : "no calling model"}`,
          )
        }
        return {
          data: {
            width: admitted.image.width,
            height: admitted.image.height,
            source: admitted.image.source,
          },
          images: [admitted.image],
        }
      },
    },
    {
      name: "relay",
      description:
        "Send a text through the bot's resident cat process in its VM and read it back (verification tool).",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      permission: "allow",
      preview: (args) => ({ title: `Relay "${args.text}"?`, fields: [] }),
      async execute(args, context) {
        return { data: { echoed: await context.attachment.roundtrip(args.text) } }
      },
    },
    {
      name: "hidden",
      description: "Must never be visible (verification tool).",
      parameters: {},
      permission: "disallow",
      preview: () => ({ title: "Hidden?", fields: [] }),
      async execute() {
        record({ op: "executed", tool: "hidden" })
        return {}
      },
    },
  ],
})

const probemail = (record) => ({
  id: "probemail",
  name: "Probe mail",
  sessions: "main",
  tools: [
    {
      name: "send",
      description: "Send a message to someone (verification tool; it only records the message).",
      parameters: {
        to: { type: "string", required: true },
        message: { type: "string", required: true },
      },
      permission: "ask",
      ask: { waitMs: 20_000, ttlMs: 5 * 60_000 },
      async snapshot(_args, run) {
        const host = await run.environment.exec({
          argv: ["hostname"],
          timeoutMs: 10_000,
          maxOutputBytes: 256,
        })
        return { from: text(host.stdout).trim() }
      },
      preview: (args, snapshot) => ({
        title: "Send this message?",
        fields: [
          { label: "From", value: String(snapshot?.from) },
          { label: "To", value: args.to },
        ],
        body: args.message,
      }),
      async execute(args, run) {
        record({
          op: "executed",
          tool: "send",
          args,
          trigger: run.trigger,
          caller: run.caller?.sessionId,
        })
        return { data: { sent: true, to: args.to } }
      },
    },
  ],
})

const WIDE_TOOLS = [
  "navigate",
  "navigate_back",
  "wait_for",
  "snapshot",
  "find",
  "take_screenshot",
  "console_messages",
  "network_requests",
  "network_request",
  "click",
  "type",
  "fill_form",
  "press_key",
  "select_option",
  "hover",
  "drag",
  "handle_dialog",
  "file_upload",
  "drop",
  "tabs",
  "resize",
  "emulate_media",
  "evaluate",
  "pdf_save",
  "mouse_click_xy",
  "mouse_move_xy",
  "mouse_drag_xy",
  "send_report",
  "post_comment",
  "run_code_unsafe",
]

const probewide = (record) => ({
  id: "probewide",
  name: "Probe wide",
  description: {
    en: "Verification connector with many tools.",
    ja: "ツールの多い検証用コネクター",
  },
  sessions: "bot",
  settings: [
    {
      key: "engine",
      kind: "choice",
      label: { en: "Engine", ja: "エンジン" },
      options: [
        { value: "chromium", label: { en: "Chromium" } },
        { value: "firefox", label: { en: "Firefox" } },
      ],
      default: "chromium",
    },
    {
      key: "timeoutSeconds",
      kind: "integer",
      label: { en: "Timeout (seconds)", ja: "タイムアウト（秒）" },
      description: { en: "How long a step may take.", ja: "1 つの操作にかけられる時間。" },
      min: 1,
      max: 600,
      default: 30,
    },
  ],
  tools: WIDE_TOOLS.map((name) => ({
    name,
    description: `Verification tool "${name}": records the call and does nothing else. It stands for the browser connector's tool of the same name, so that a long list of tools can be read in the settings.`,
    parameters: {},
    permission:
      name === "run_code_unsafe"
        ? "disallow"
        : name.startsWith("send_") || name.startsWith("post_")
          ? "ask"
          : "allow",
    preview: () => ({ title: `Run ${name}?`, fields: [] }),
    async execute() {
      record({ op: "executed", tool: name })
      return { text: name }
    },
  })),
})

export const probeConnectors = ({ record, minMemoryMiB, manyTools }) => [
  probe(record, minMemoryMiB),
  probemail(record),
  ...(manyTools ? [probewide(record)] : []),
]
