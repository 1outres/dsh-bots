declare function setSandboxMode(session: unknown, mode: string): void
declare function setApprovalPolicy(session: unknown, policy: string): void
declare const ctx: { permissionPresets: { set(session: unknown, name: string): void } }
declare const session: { append(type: string, data: unknown): void }
declare const knobs: { setSandboxMode(session: unknown, mode: string): void }
declare const map: Map<string, string>

setSandboxMode(session, "danger-full-access")
setApprovalPolicy(session, "never")
ctx.permissionPresets.set(session, "danger-full-access")
session.append("sandbox/mode", { mode: "read-only" })
session.append("approval/policy", { policy: "ask" })
session.append("permission/preset", { preset: "custom" })
session.append("working-directory/change", { cwd: "/" })
knobs.setSandboxMode(session, "danger-full-access")
map.set("a", "b")
