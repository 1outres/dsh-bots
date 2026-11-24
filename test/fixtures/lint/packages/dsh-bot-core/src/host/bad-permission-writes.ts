declare function setSandboxMode(session: unknown, mode: string): void
declare function setApprovalPolicy(session: unknown, policy: string): void
declare const ctx: { permissionPresets: { set(session: unknown, name: string): void } }
declare const session: { append(type: string, data: unknown): void }
declare const knobs: { setSandboxMode(session: unknown, mode: string): void }
declare const map: Map<string, string>

setSandboxMode(session, "danger-full-access") // rule: 38
setApprovalPolicy(session, "never") // rule: 38
ctx.permissionPresets.set(session, "danger-full-access") // rule: 38
session.append("sandbox/mode", { mode: "read-only" }) // rule: 38
session.append("approval/policy", { policy: "ask" }) // rule: 38
session.append("permission/preset", { preset: "custom" }) // rule: 38
session.append("working-directory/change", { cwd: "/" })
knobs.setSandboxMode(session, "danger-full-access")
map.set("a", "b")
