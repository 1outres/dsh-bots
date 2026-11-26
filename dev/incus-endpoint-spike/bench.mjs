const M = "/home/loutres/src/dsh-bots/packages/dsh-bot-vm/node_modules/@deepseek-ai/"
const { Context, Service } = await import(`${M}cordis/lib/index.mjs`).catch(
  () => import(`${M}cordis/lib/index.js`),
)
const { SshConnection } = await import(`${M}dsh-ssh/lib/index.js`)
const { default: SshSubprocessRuntime } = await import(`${M}dsh-subprocess-ssh/lib/index.js`)
const VM = "/home/loutres/src/dsh-bots/packages/dsh-bot-vm/"
const { default: Fs } = await import(`${VM}lib/fs.js`)

const [alias, conc = "8"] = process.argv.slice(2)
const WS = "/home/bot/workspace"
const config = {
  host: alias,
  launch: { kind: "node-script", node: "/usr/bin/node" },
  helper: "/opt/dsh-ssh-helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js",
  helperHash: "8cf436d3657343765ea0031bcc6e78edb20580fb9c2595fd7bb08b193021f40e",
  workspace: WS,
  requestTimeoutMs: 30000,
  maxFrameBytes: 64 * 1024 * 1024,
  maxPending: 128,
  leaseMs: 30000,
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return (
    "p50=" +
    q(0.5).toFixed(1) +
    "ms p95=" +
    q(0.95).toFixed(1) +
    "ms max=" +
    s[s.length - 1].toFixed(1) +
    "ms"
  )
}
const now = () => performance.now()

async function compose() {
  const root = new Context()
  const t = now()
  let ssh
  await root.plugin({
    name: "ssh",
    apply: (ctx) => {
      ssh = new SshConnection(ctx, config)
    },
  })
  await ssh.ready
  const ready = now() - t
  await root.plugin(
    class extends Service {
      constructor(ctx) {
        super(ctx, "sandboxPolicy")
        this.defaultMode = "danger-full-access"
        this.workspaceRoot = WS
      }
      resolve() {
        return { mode: "danger-full-access", workspaceRoot: WS }
      }
    },
  )
  await root.plugin(Fs)
  await root.plugin(SshSubprocessRuntime)
  for (
    let i = 0;
    i < 50 && (root.get("fs") === undefined || root.get("subprocess") === undefined);
    i++
  )
    await new Promise((r) => setTimeout(r, 100))
  if (root.get("fs") === undefined)
    console.log(
      "services:",
      ["ssh", "sandboxPolicy", "fs", "subprocess"]
        .map((k) => `${k}=${root.get(k) !== undefined}`)
        .join(" "),
    )
  return { root, ssh, ready, fs: root.get("fs"), sub: root.get("subprocess") }
}

function run(sub, argv, input) {
  const h = sub.spawn({
    argv,
    cwd: WS,
    stdio: { stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" },
    graceMs: 2000,
  })
  const out = []
  let bytes = 0
  h.stdout.on("data", (d) => {
    bytes += d.length
    if (out.length < 4) out.push(d)
  })
  h.stderr.on("data", () => {})
  if (input !== undefined) {
    h.stdin.end(input)
  }
  return h.done.then((o) => ({
    outcome: o,
    bytes,
    head: Buffer.concat(out).toString("utf8").slice(0, 200),
  }))
}

const c = await compose()
console.log("handshake(ready)", `${c.ready.toFixed(0)}ms`)
const target = await c.fs.resolve(WS)
const rtt = []
for (let i = 0; i < 50; i++) {
  const t = now()
  await c.fs.stat(target)
  rtt.push(now() - t)
}
console.log("fs.stat RTT x50", stats(rtt))
const sp = []
for (let i = 0; i < 10; i++) {
  const t = now()
  await run(c.sub, ["true"])
  sp.push(now() - t)
}
console.log("spawn true x10", stats(sp))
for (const mb of [4, 16, 32]) {
  const text = `${"x".repeat(mb * 1024 * 1024 - 1)}\n`
  const f = await c.fs.resolve(`${WS}/bench-${mb}.txt`)
  let t = now()
  await c.fs.writeText(f, text)
  const w = now() - t
  t = now()
  let back = ""
  for await (const chunk of await c.fs.streamText(f)) back += chunk
  const r = now() - t
  console.log(
    "fs.writeText/streamText " +
      mb +
      "MiB: write " +
      w.toFixed(0) +
      "ms (" +
      ((mb / w) * 1000).toFixed(1) +
      " MiB/s), read " +
      r.toFixed(0) +
      "ms (" +
      ((mb / r) * 1000).toFixed(1) +
      " MiB/s) ok=" +
      (back.length === text.length),
  )
}
{
  let t = now()
  const r = await run(c.sub, ["sh", "-c", "head -c 67108864 /dev/zero"])
  const d = now() - t
  console.log(
    "subprocess stdout 64MiB: " +
      d.toFixed(0) +
      "ms (" +
      ((64 / d) * 1000).toFixed(1) +
      " MiB/s) bytes=" +
      r.bytes,
  )
  const input = Buffer.alloc(32 * 1024 * 1024, 7)
  t = now()
  const w = await run(
    c.sub,
    ["sh", "-c", "cat > bench-stdin.bin && wc -c < bench-stdin.bin"],
    input,
  )
  const d2 = now() - t
  console.log(
    "subprocess stdin 32MiB: " +
      d2.toFixed(0) +
      "ms (" +
      ((32 / d2) * 1000).toFixed(1) +
      " MiB/s) remote=" +
      w.head.trim(),
  )
  const g = await run(c.sub, ["sh", "-c", "rg --version | head -1; ls -la"])
  console.log(
    "subprocess sample:",
    JSON.stringify(g.head.slice(0, 80)),
    JSON.stringify(g.outcome).slice(0, 120),
  )
}
;(await c.root.dispose?.()) ?? c.ssh.dispose()
const n = Number(conc)
let t = now()
const many = await Promise.all(Array.from({ length: n }, () => compose()))
const all = now() - t
const lat = []
t = now()
await Promise.all(
  many.map(async (m) => {
    for (let i = 0; i < 20; i++) {
      const s = now()
      await m.fs.stat(await m.fs.resolve(WS))
      lat.push(now() - s)
    }
  }),
)
console.log(
  n +
    " parallel connections: all ready in " +
    all.toFixed(0) +
    "ms (each " +
    many.map((m) => m.ready.toFixed(0)).join(",") +
    "); 20 stats each " +
    (now() - t).toFixed(0) +
    "ms, " +
    stats(lat),
)
await Promise.all(many.map((m) => m.ssh.dispose()))
process.exit(0)
