import type { PermissionBundle } from "../../shared/permission"
import { botIdOfPreset } from "../../shared/preset"
import { type BotWorkspaceOptions, PERMISSION_BUNDLES } from "../../shared/workspaces"

/** dsh-permission-presets' catalog, as a grant chooses from it. */
export interface PermissionCatalog {
  readonly names: readonly string[]
  resolve(name: string): PermissionBundle
  optionOf(name: string): { readonly name: string }
  readonly defaultPreset: string
}

/** The current-session-only Auto preset (dsh-permission-presets `AUTO_PRESET`): not a mode a session starts in. */
const AUTO_PRESET = "auto"

/**
 * What a grant can choose (docs/specs/bot-managed-sessions.md §10.1): DSH's
 * Agent presets that are no bot's and load, and DSH's configured permission
 * presets, or every pair of knobs where DSH has none.
 */
export function workspaceOptions(input: {
  readonly presets: readonly {
    readonly id: string
    readonly name?: string
    readonly broken?: string
  }[]
  readonly defaultPreset: string
  readonly permissions: PermissionCatalog | undefined
}): BotWorkspaceOptions {
  const { permissions } = input
  return {
    agentPresets: input.presets
      .filter((preset) => botIdOfPreset(preset.id) === undefined && preset.broken === undefined)
      .map((preset) => ({
        id: preset.id,
        ...(preset.name === undefined ? {} : { name: preset.name }),
        isDefault: preset.id === input.defaultPreset,
      })),
    permissions:
      permissions === undefined
        ? PERMISSION_BUNDLES.map((permission) => ({
            id: `${permission.sandbox}/${permission.approval}`,
            permission,
            isDefault: false,
          }))
        : permissions.names
            .filter((name) => name !== AUTO_PRESET)
            .map((name) => {
              const { sandbox, approval } = permissions.resolve(name)
              return {
                id: name,
                name: permissions.optionOf(name).name,
                permission: { sandbox, approval },
                isDefault: name === permissions.defaultPreset,
              }
            }),
  }
}
