import { parseProjectName } from "../backend/incus/endpoint"
import {
  incusOf,
  objectOf,
  PLACEMENT_VERSION,
  placementOfRecord,
  type StoredPlacement,
  textOf,
} from "./placement"

export interface LegacySocket {
  readonly socket: string
  readonly project: string
}

export type StoredReading =
  | { readonly kind: "current"; readonly placement: StoredPlacement }
  | { readonly kind: "migrated"; readonly placement: StoredPlacement }
  | { readonly kind: "legacy-socket"; readonly from: LegacySocket }

const CHOOSE_AGAIN = "choose the VM host again in the dsh-bots settings"

function versionTwo(record: Readonly<Record<string, unknown>>, what: string): StoredReading {
  const project = parseProjectName(textOf(record, "project", what))
  const endpoint = objectOf(record.endpoint, `${what}: the endpoint`)
  switch (endpoint.kind) {
    case "local": {
      const socket = textOf(endpoint, "socket", what)
      if (!socket.startsWith("/")) throw new Error(`${what}: the socket must be an absolute path`)
      return { kind: "legacy-socket", from: { socket, project } }
    }
    case "remote":
      return {
        kind: "migrated",
        placement: {
          version: PLACEMENT_VERSION,
          backend: incusOf({ ...endpoint, project }, what),
          origin: { kind: "custom" },
        },
      }
    default:
      throw new Error(`${what} has an unknown kind`)
  }
}

export function readStoredPlacement(text: string, what = "the stored VM host"): StoredReading {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${what} is not JSON`)
  }
  const record = objectOf(value, what)
  switch (record.version) {
    case PLACEMENT_VERSION:
      return { kind: "current", placement: placementOfRecord(record, what) }
    case 2:
      return versionTwo(record, what)
    case 1:
      throw new Error(
        `${what} was written by an earlier development version (no project); ${CHOOSE_AGAIN}`,
      )
    default:
      throw new Error(`${what} has an unknown version`)
  }
}
