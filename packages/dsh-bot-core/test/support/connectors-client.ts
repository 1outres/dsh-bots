import type {
  BotConnectorView,
  ConnectorDescriptor,
  ConnectorPermission,
  ConnectorReadiness,
  ConnectorToolPermission,
} from "../../src/shared/connectors"

export const probeDescriptor: ConnectorDescriptor = {
  id: "probe",
  name: "Probe",
  description: { en: "Drives the VM.", ja: "VM を操作する" },
  sessions: "bot",
  settings: [
    {
      key: "greeting",
      kind: "text",
      agent: { note: "Test setting.", change: "free" },
      label: { en: "Greeting" },
      default: "hello",
      maxLength: 5,
    },
    {
      key: "slow",
      kind: "toggle",
      agent: { note: "Test setting.", change: "free" },
      label: { en: "Slow" },
      default: false,
    },
    {
      key: "depth",
      kind: "integer",
      agent: { note: "Test setting.", change: "free" },
      label: { en: "Depth" },
      min: 1,
      max: 9,
      default: 3,
    },
    {
      key: "mode",
      kind: "choice",
      agent: { note: "Test setting.", change: "free" },
      label: { en: "Mode" },
      options: [
        { value: "a", label: { en: "A" } },
        { value: "b", label: { en: "B" } },
      ],
      default: "a",
    },
  ],
  minimumSpec: { memoryMiB: 4096 },
  requires: [],
  preparation: { hint: { en: "The first preparation takes a while." } },
  tools: [
    { name: "echo", toolName: "probe_echo", description: "Echo a text back.", permission: "allow" },
    { name: "send", toolName: "probe_send", description: "Send a message.", permission: "ask" },
    {
      name: "unsafe",
      toolName: "probe_unsafe",
      description: "Run any code.",
      permission: "disallow",
    },
  ],
}

export function probeView(
  options: {
    enabled?: boolean
    readiness?: ConnectorReadiness
    overrides?: Readonly<Record<string, ConnectorPermission>>
    descriptor?: ConnectorDescriptor
  } = {},
): BotConnectorView {
  const descriptor = options.descriptor ?? probeDescriptor
  const permissions: ConnectorToolPermission[] = descriptor.tools.map((tool) => {
    const override = options.overrides?.[tool.name]
    return {
      connectorId: descriptor.id,
      tool: tool.name,
      default: tool.permission,
      ...(override === undefined ? {} : { override }),
      effective: override ?? tool.permission,
    }
  })
  return {
    connector: descriptor,
    enabled: options.enabled ?? false,
    values: { greeting: "hello", slow: false, depth: 3, mode: "a" },
    readiness: options.readiness ?? { state: "disabled" },
    permissions,
    status: {},
  }
}
export function idleConnections(): import("../../src/client/connections-model").ConnectionsFeed {
  const unused = async (): Promise<never> => {
    throw new Error("unused")
  }
  return {
    getSnapshot: () => ({ status: "loading" }),
    subscribe: () => () => {},
    configureClient: unused,
    authorize: unused,
    rename: unused,
    assign: unused,
    disconnect: unused,
  }
}
