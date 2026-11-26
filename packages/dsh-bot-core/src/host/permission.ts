import type { ApprovalPolicy, PermissionBundle, SandboxMode } from "../shared/permission"
import { BOT_PERMISSION } from "../shared/permission"

export interface PermissionPresets<S> {
  readonly names: readonly string[]
  resolve(name: string): PermissionBundle
  optionOf(name: string): { readonly name: string }
  readonly defaultPreset: string
  set(session: S, name: string): void
}

export interface PermissionKnobs<S> {
  sandboxOverride(session: S): SandboxMode | undefined
  approvalOverride(session: S): ApprovalPolicy | undefined
  setSandboxMode(session: S, mode: SandboxMode): void
  setApprovalPolicy(session: S, policy: ApprovalPolicy): void
}

export class BotPermissionError extends Error {
  constructor(message: string) {
    super(`bot-core: ${message}`)
    this.name = "BotPermissionError"
  }
}

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
  attachPresets(presets: PermissionPresets<S>): () => void
  pin(session: S): void
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
