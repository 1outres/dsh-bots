export function register(host: { agentPresets: { register(preset: object): unknown } }) {
  return host.agentPresets.register({ id: "x" }) // rule: 2
}
