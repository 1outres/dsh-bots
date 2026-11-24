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

/** dsh-typert-registry `TypertContribution`, as a hand-declared Host face registers it. */
export interface HostRemoteContribution {
  readonly package: string
  readonly face: "host"
  readonly schemas: readonly []
  readonly model: { readonly services: []; readonly events: []; readonly objects: [] }
  readonly invocations: readonly InvocationDescriptor[]
}

/** dsh-typert-registry's `typert` service, as bot-core registers its contract with it. */
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

/**
 * bot-core's Remote as strict typert definitions. The Gateway dispatches an
 * endpoint with a strict definition by it and never derives the wire from the
 * Host method's source text (its SRC mode), so the built bundle's parameter
 * identifiers do not reach the wire.
 */
export const HOST_REMOTE_CONTRIBUTION: HostRemoteContribution = {
  package: REMOTE_PACKAGE,
  face: "host",
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: REMOTE_ENDPOINTS.map(invocation),
}

export const registerRemoteContract = (typert: TypertRegistry): TypertDisposer =>
  typert.register(HOST_REMOTE_CONTRIBUTION)
