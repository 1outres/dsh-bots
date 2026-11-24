/**
 * bot-core sets {@link BOT_PERMISSION} on every bot Agent's session (index.ts
 * calls {@link BotPermissions.pin} from `agent/created` and when an Agent
 * joins its bot's preset), and a Workspace grant's permission on the DSH
 * sessions a bot's Main session starts there ({@link BotPermissions.apply}).
 *
 * Who records it depends on the composition, as in DSH:
 * - With dsh-permission-presets, through `permissionPresets.set` with the
 *   configured preset whose bundle is exactly the bot's: it records that
 *   preset as the session's selection, then writes the knobs that differ
 *   through their canonical setters, so the session reads that preset, never
 *   `custom`. Its own `agent/created` listener (`prepend`) pins the
 *   profile's default first; bot-core's listener is not prepended, so it runs
 *   after that and its write is the last. A preset table without the bot's
 *   bundle is refused ({@link BotPermissionError}).
 * - Without it, the knobs' canonical setters (`setSandboxMode`,
 *   `setApprovalPolicy`), for each knob whose override differs.
 */
import type { ApprovalPolicy, PermissionBundle, SandboxMode } from "../shared/permission"
import { BOT_PERMISSION } from "../shared/permission"

/** dsh-permission-presets' `permissionPresets` service, as bot-core uses it. */
export interface PermissionPresets<S> {
  /** Configured presets in table order (and `auto` while its integration is live). */
  readonly names: readonly string[]
  resolve(name: string): PermissionBundle
  /** The preset's display entry. */
  optionOf(name: string): { readonly name: string }
  /** The preset fresh sessions start in. */
  readonly defaultPreset: string
  set(session: S, name: string): void
}

/** A session's sandbox mode and approval policy, read and written where DSH keeps them. */
export interface PermissionKnobs<S> {
  /** `sandboxPolicy.overrideOf`. */
  sandboxOverride(session: S): SandboxMode | undefined
  /** `approval.overrideOf`. */
  approvalOverride(session: S): ApprovalPolicy | undefined
  /** dsh-sandbox-policy `setSandboxMode`. */
  setSandboxMode(session: S, mode: SandboxMode): void
  /** dsh-user-approval `setApprovalPolicy`. */
  setApprovalPolicy(session: S, policy: ApprovalPolicy): void
}

/** Thrown from `agent/created` when the bot's permission cannot be recorded; DSH rolls the Agent back. */
export class BotPermissionError extends Error {
  constructor(message: string) {
    super(`bot-core: ${message}`)
    this.name = "BotPermissionError"
  }
}

/** The first preset of the table whose bundle is exactly `bundle`. */
export function presetOfBundle<S>(presets: PermissionPresets<S>, bundle: PermissionBundle): string {
  const name = presets.names.find((candidate) => {
    const spec = presets.resolve(candidate)
    return spec.sandbox === bundle.sandbox && spec.approval === bundle.approval
  })
  if (name === undefined) {
    throw new BotPermissionError(
      `no permission preset has sandbox "${bundle.sandbox}" with approval "${bundle.approval}"; add one to dsh-permission-presets' presets`,
    )
  }
  return name
}

export interface BotPermissions<S> {
  /** dsh-permission-presets is composed; the returned function detaches it. */
  attachPresets(presets: PermissionPresets<S>): () => void
  /**
   * Record the bot permission on the session. Writes nothing when it is
   * already recorded.
   * @throws {BotPermissionError} when the preset table lacks the bundle.
   */
  pin(session: S): void
  /**
   * Record `bundle` on the session the same way.
   * @throws {BotPermissionError} when the preset table lacks the bundle.
   */
  apply(session: S, bundle: PermissionBundle): void
}

export function createBotPermissions<S>(knobs: PermissionKnobs<S>): BotPermissions<S> {
  let presets: PermissionPresets<S> | undefined

  const setKnobs = (session: S, bundle: PermissionBundle) => {
    if (knobs.sandboxOverride(session) !== bundle.sandbox) {
      knobs.setSandboxMode(session, bundle.sandbox)
    }
    if (knobs.approvalOverride(session) !== bundle.approval) {
      knobs.setApprovalPolicy(session, bundle.approval)
    }
  }

  const apply = (session: S, bundle: PermissionBundle) => {
    if (presets === undefined) {
      setKnobs(session, bundle)
      return
    }
    presets.set(session, presetOfBundle(presets, bundle))
  }

  return {
    attachPresets(attached) {
      presets = attached
      return () => {
        if (presets === attached) presets = undefined
      }
    },
    pin: (session) => apply(session, BOT_PERMISSION),
    apply,
  }
}
