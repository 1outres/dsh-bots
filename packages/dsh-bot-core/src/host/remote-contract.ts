import type {
  InvocationDescriptor,
  InvocationParameterDescriptor,
  TypertCodec,
  TypertDisposer,
} from "@deepseek-ai/dsh-typert-protocol"
import {
  REMOTE_ENDPOINTS,
  REMOTE_JSON_TYPE,
  REMOTE_PACKAGE,
  type RemoteEndpoint,
  type RemoteParameter,
} from "../shared/remote-contract"

export interface HostRemoteContribution {
  readonly package: string
  readonly face: "host"
  readonly schemas: readonly []
  readonly model: { readonly services: []; readonly events: []; readonly objects: [] }
  readonly invocations: readonly InvocationDescriptor[]
}

export interface TypertRegistry {
  register(contribution: HostRemoteContribution): TypertDisposer
}

const codec: TypertCodec = {
  mode: "strict",
  typeSymbol: REMOTE_JSON_TYPE,
  create: () => ({ parse: (value: unknown) => value }),
}

const parameter = ({ name, optional }: RemoteParameter): InvocationParameterDescriptor => ({
  name,
  wire: name,
  source: "json",
  codec,
  ...(optional ? { acceptsUndefined: true as const } : {}),
})

function invocation({ id, namespace, method, contract }: RemoteEndpoint): InvocationDescriptor {
  return {
    id,
    service: namespace,
    namespace,
    method,
    ...(contract.stream ? { mode: "stream" as const } : {}),
    invocation: { kind: "direct" },
    parameters: contract.parameters.map(parameter),
    ...(contract.cancellable ? { cancellation: { parameter: "signal" as const } } : {}),
    ...(contract.uplink ? { uplink: { codec } } : {}),
    result: codec,
  }
}

export const HOST_REMOTE_CONTRIBUTION: HostRemoteContribution = {
  package: REMOTE_PACKAGE,
  face: "host",
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: REMOTE_ENDPOINTS.map(invocation),
}

export const registerRemoteContract = (typert: TypertRegistry): TypertDisposer =>
  typert.register(HOST_REMOTE_CONTRIBUTION)
