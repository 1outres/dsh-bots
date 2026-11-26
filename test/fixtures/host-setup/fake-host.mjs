import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [name, ...args] = process.argv.slice(2)
const statePath = process.env.FAKE_STATE
const state = JSON.parse(readFileSync(statePath, "utf8"))
const out = []
const err = []
let status = 0

const save = () => {
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2))
  renameSync(`${statePath}.tmp`, statePath)
}
const print = (text) => out.push(text)
const fail = (text, code = 1) => {
  err.push(text)
  status = code
}
const stdin = () => readFileSync(0, "utf8")
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

const blockUntilReleased = (key) => {
  if (!state.block?.includes(key)) return
  const dir = process.env.FAKE_DIR
  writeFileSync(join(dir, "blocked"), key)
  while (!existsSync(join(dir, "release"))) sleep(20)
}

const options = (list, valued) => {
  const positional = []
  const flags = {}
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]
    if (valued.includes(arg)) flags[arg] = list[++i]
    else if (arg.startsWith("--") && arg.includes("="))
      flags[arg.slice(0, arg.indexOf("="))] = arg.slice(arg.indexOf("=") + 1)
    else if (arg.startsWith("-") && arg.length > 1) flags[arg] = true
    else if (arg !== "") positional.push(arg)
  }
  return { positional, flags }
}

const settings = (list) =>
  Object.fromEntries(list.map((s) => [s.slice(0, s.indexOf("=")), s.slice(s.indexOf("=") + 1)]))

const incus = () => {
  const s = state.incus
  if (args[0] === "--version") return print(s.clientVersion)
  const createOptions = []
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-c" && args[0] === "project") createOptions.push(args[++i])
    else rest.push(args[i])
  }
  const { positional: p, flags } = options(rest, ["--project", "-f", "-c", "--projects"])
  const project = flags["--project"] ?? "default"
  const key = p.join(" ")
  const show = (object, label) =>
    object === undefined
      ? fail(`Error: ${label} not found`)
      : print(JSON.stringify(object, null, 2))
  const missing = (object, label) => {
    if (object !== undefined) return false
    fail(`Error: ${label} not found`)
    return true
  }
  if (key === "admin waitready") return
  if (key === "version")
    return print(`Client version: ${s.clientVersion}\nServer version: ${s.serverVersion}`)
  if (key === "info")
    return print(`environment:\n  driver: ${s.drivers}\n  server_version: ${s.serverVersion}`)
  if (key === "query /1.0")
    return print(
      JSON.stringify(
        {
          environment: { certificate_fingerprint: s.certificate, server_version: s.serverVersion },
          auth: "trusted",
        },
        null,
        2,
      ),
    )
  if (key === "list") return print(Object.keys(s.instances[project] ?? {}).join("\n"))
  switch (`${p[0]} ${p[1]}`) {
    case "config get":
      if (p.length === 3) return print(s.config[p[2]] ?? "")
      return print(s.instances[project]?.[p[2]]?.[p[3]] ?? "")
    case "config set":
      Object.assign(s.config, settings(p.slice(2)))
      return
    case "config trust": {
      const trust = p[2]
      if (trust === "list-tokens") return print(s.tokens.join("\n"))
      if (trust === "revoke-token") {
        s.tokens = s.tokens.filter((t) => t !== p[3])
        return
      }
      if (trust === "add") {
        s.tokens.push(p[3])
        const token = Buffer.from(
          JSON.stringify({
            client_name: p[3],
            projects: flags["--projects"],
            restricted: flags["--restricted"] === true,
          }),
        ).toString("base64")
        s.issued.push(token)
        return print(s.tokenOutput ?? `Client ${p[3]} certificate add token:\n${token}`)
      }
      const found = s.trust.find((c) => c.fingerprint.startsWith(p[3]))
      if (trust === "show")
        return found === undefined ? fail("Error: not found") : print(JSON.stringify(found))
      if (trust === "remove") {
        if (missing(found, "certificate")) return
        s.trust = s.trust.filter((c) => c !== found)
        return
      }
      break
    }
    case "storage show":
      return show(s.storage[p[2]], "pool")
    case "storage create":
      s.storage[p[2]] = { driver: p[3], config: settings(p.slice(4)) }
      return
    case "storage list":
      return print(Object.keys(s.storage).join("\n"))
    case "storage volume": {
      const volumes = s.volumes[project]?.[p[3]] ?? {}
      if (p[2] === "list")
        return print(
          Object.entries(volumes)
            .map(([n, v]) => `${v.type},${n}`)
            .join("\n"),
        )
      if (p[2] === "get") return print(volumes[p[4].replace(/^custom\//, "")]?.[p[5]] ?? "")
      break
    }
    case "network acl": {
      const acl = p[3]
      if (p[2] === "show") return show(s.acls[acl], "ACL")
      if (p[2] === "create") {
        s.acls[acl] = { rules: "" }
        return
      }
      if (p[2] === "edit") {
        if (missing(s.acls[acl], "ACL")) return
        s.acls[acl] = { rules: stdin() }
        return
      }
      break
    }
    case "network show":
      return show(s.networks[p[2]], "network")
    case "network create":
      s.networks[p[2]] = { type: flags["--type"], config: settings(p.slice(3)) }
      return
    case "network set": {
      const net = s.networks[p[2]]
      if (missing(net, "network")) return
      if (flags["--property"]) Object.assign(net, settings(p.slice(3)))
      else Object.assign(net.config, settings(p.slice(3)))
      return
    }
    case "network unset":
      delete s.networks[p[2]].config[p[3]]
      return
    case "network get":
      return print(s.networks[p[2]]?.config[p[3]] ?? "")
    case "project show":
      return show(s.projects[p[2]], "project")
    case "project create":
      s.projects[p[2]] = { config: settings(createOptions) }
      return
    case "project set": {
      const target = s.projects[p[2]]
      if (missing(target, "project")) return
      if (flags["--property"]) Object.assign(target, settings(p.slice(3)))
      else Object.assign(target.config, settings(p.slice(3)))
      return
    }
    case "project get":
      return print(s.projects[p[2]]?.config[p[3]] ?? "")
    case "project unset":
      delete s.projects[p[2]].config[p[3]]
      return
  }
  fail(`fake incus: unknown command ${args.join(" ")}`, 64)
}

const commands = {
  incus,
  uname: () => print(state.arch),
  id: () => print(String(state.uid)),
  df: () =>
    print(
      `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 0 0 ${state.freeGiB * 1048576} 1% /`,
    ),
  ss: () => {
    const port = Number(args.at(-1).replace(/^sport = :/, ""))
    if (state.listeners.includes(port)) print(`LISTEN 0 4096 *:${port} *:*`)
  },
  sudo: () => {
    if (state.sudo !== "nopassword") fail("sudo: a password is required")
  },
  "dpkg-query": () => {
    if (state.packages.includes(args.at(-1))) print("install ok installed")
    else fail("dpkg-query: no packages found")
  },
  "apt-get": () => {
    if (args[0] === "update") return
    blockUntilReleased("apt-get install")
    const wanted = args.filter((a) => !a.startsWith("-") && a !== "install")
    state.packages.push(...wanted)
    if (wanted.includes("incus"))
      Object.assign(state.units, { "incus.socket": {}, "incus.service": {} })
  },
  rpm: () => {
    if (!state.packages.includes(args.at(-1))) fail("not installed")
  },
  dnf: () => {
    state.packages.push(...args.filter((a) => !a.startsWith("-") && a !== "install"))
  },
  curl: () => writeFileSync(args[args.indexOf("-o") + 1], "KEY"),
  gpg: () => print(`pub:-:4096:1:82CC8797C838DCFD:\nfpr:::::::::${state.zabblyFingerprint}:`),
  modprobe: () => {
    if (!state.modprobe) return fail("modprobe: FATAL: Module vhost_vsock not found")
    mkdirSync(join(process.env.DSH_BOTS_SYSROOT, "sys/module/vhost_vsock"), { recursive: true })
  },
  systemctl: () => {
    const unitName = args.at(-1)
    const verb = args[0]
    if (verb === "daemon-reload") return
    if (
      state.units[unitName] === undefined &&
      existsSync(join(process.env.DSH_BOTS_SYSROOT, "etc/systemd/system", unitName))
    )
      state.units[unitName] = {}
    const unit = state.units[unitName]
    if (unit === undefined) return fail(`Unit ${unitName} not found.`, 5)
    if (verb === "is-enabled") {
      if (!unit.enabled) status = 1
      return
    }
    if (verb === "is-active") {
      if (!unit.active) status = 3
      return
    }
    if (verb === "enable") unit.enabled = true
    if (verb === "start" || verb === "restart") unit.active = true
  },
  ufw: () => {
    if (args[0] === "status") {
      print(`Status: ${state.ufw.active ? "active" : "inactive"}`)
      for (const rule of state.ufw.rules) print(rule)
      return
    }
    const rule = args.join(" ")
    if (!state.ufw.rules.includes(rule)) state.ufw.rules.push(rule)
  },
  "firewall-cmd": () => {
    const fw = state.firewalld
    const arg =
      args.find((a) => a.startsWith("--") && a !== "--permanent" && !a.startsWith("--zone")) ?? ""
    const [flag, value] = arg.split("=")
    if (flag === "--state") return fw.running ? print("running") : fail("not running", 252)
    if (flag === "--reload") return
    const list = flag.endsWith("interface") ? fw.interfaces : fw.ports
    if (flag.startsWith("--query")) return list.includes(value) ? undefined : fail("no")
    if (flag.startsWith("--add")) list.push(value)
  },
  iptables: () =>
    state.dockerUser
      ? print("-N DOCKER-USER")
      : fail("iptables: No chain/target/match by that name."),
  nft: () => print(state.nftChains),
}

const call = [name, ...args].join(" ")
state.calls.push(call)
if (state.failOn.some((prefix) => call.startsWith(prefix))) fail(`fake: ${call} fails`)
else commands[name]()
state.calls.push(`${name} exited ${status}`)
save()
if (out.length > 0) process.stdout.write(`${out.join("\n")}\n`)
if (err.length > 0) process.stderr.write(`${err.join("\n")}\n`)
process.exit(status)
