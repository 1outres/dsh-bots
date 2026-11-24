/**
 * Argument shapes several desktop tools share, and the checks the parameter
 * schema cannot express (bounds, one of two forms).
 */
import { type AgentPoint, ELEMENT_ID } from "../agent/protocol"
import { type FrameMemory, type Size, toScreen } from "../frame"

export const ELEMENT_DESCRIPTION =
  "Element id from desktop_tree or desktop_find (like 4:17); valid for the 8 latest snapshots."

export function pointParameters<const P extends string>(prefix: P, what: string) {
  return {
    [`${prefix}x`]: {
      type: "integer",
      description: `X of ${what} in the latest desktop_screenshot's image (give with y, or give an element instead).`,
    },
    [`${prefix}y`]: {
      type: "integer",
      description: `Y of ${what} in the latest desktop_screenshot's image.`,
    },
    [`${prefix}element`]: {
      type: "string",
      description: `Element id whose centre is ${what} (instead of x and y).`,
    },
  } as {
    readonly [K in `${P}x` | `${P}y`]: { readonly type: "integer"; readonly description: string }
  } & { readonly [K in `${P}element`]: { readonly type: "string"; readonly description: string } }
}

export interface ResolvedPoint {
  readonly at: AgentPoint
  /** The screen size the coordinates assume, when they came from a screenshot. */
  readonly screen?: Size
}

export function elementId(value: string, name = "element"): string {
  if (!ELEMENT_ID.test(value)) throw new Error(`${name} "${value}" is not an element id like 4:17`)
  return value
}

/** A point given as model coordinates of the latest screenshot or as an element. */
export function resolvePoint(
  given: { readonly x?: number; readonly y?: number; readonly element?: string },
  frames: FrameMemory,
  what: string,
): ResolvedPoint {
  if (given.element !== undefined) {
    if (given.x !== undefined || given.y !== undefined) {
      throw new Error(`give either x and y or an element for ${what}, not both`)
    }
    return { at: { element: elementId(given.element) } }
  }
  if (given.x === undefined || given.y === undefined) {
    throw new Error(`give x and y (of the latest screenshot) or an element for ${what}`)
  }
  const frame = frames.require()
  return { at: toScreen(frame, { x: given.x, y: given.y }), screen: frame.screen }
}

export function between(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

/** The screen expectation of the points that came from one screenshot. */
export function expectation(...points: readonly ResolvedPoint[]): { expect_screen?: Size } {
  const screen = points.find((point) => point.screen !== undefined)?.screen
  return screen === undefined ? {} : { expect_screen: screen }
}
