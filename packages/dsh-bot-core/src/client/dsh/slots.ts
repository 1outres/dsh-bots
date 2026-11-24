// Source: dsh-client-ui-renderer/src/client/{registry.ts,scoped-slots.tsx} and each Slot's declaring package.
import type { ComponentType, ReactNode } from "react"

/** The Slots bot-core registers in or reads. */
export const SLOT = {
  /** dsh-client-ui-sidebar contract/slots.ts */
  sessionAction: "sidebar.session.action",
  /** dsh-client-ui-layout index.ts */
  shellOverlay: "shell.overlay",
  /** dsh-client-ui-conversation contract/slots.ts */
  mainConversation: "main.conversation",
  /** dsh-client-ui-conversation contract/slots.ts */
  conversationSession: "conversation.session",
  /** dsh-client-ui-conversation contract/slots.ts (chain; owner `ComposerChainProps`) */
  conversationComposer: "conversation.composer",
  /** dsh-client-ui-conversation contract/slots.ts (declared by `conversation.composer.bar`; occupied by ui-model-selection) */
  inputModel: "conversation.input.model",
  /** dsh-client-ui-conversation contract/slots.ts (declared by `conversation.composer.bar`; occupied by ui-permission-presets) */
  inputPermission: "conversation.input.permission",
  /** dsh-client-ui-conversation contract/slots.ts */
  sessionHeaderCorner: "conversation.session.header.corner",
  /** dsh-client-ui-sidebar-right contract/slots.ts */
  rightbarSession: "rightbar.session",
  /** dsh-client-ui-sidebar-right contract/slots.ts */
  sidebarRightTab: "sidebar.right.pane.tab",
  /** dsh-client-ui-settings contract/slots.ts (declared by ui-settings-general's `sidebar.settings` entry; owner `SettingsSectionOwnerProps`) */
  settingsSection: "settings.section",
} as const

export type SlotName = (typeof SLOT)[keyof typeof SLOT]

/** The Factories bot-core instantiates. */
export const FACTORY = {
  /** dsh-client-ui-conversation contract/slots.ts */
  conversationContent: "conversation.content",
  /** dsh-client-ui-sidebar-files FileTree.tsx */
  filesTree: "sidebar.files.tree",
} as const

export type FactoryName = (typeof FACTORY)[keyof typeof FACTORY]

/** `renderFactorySlot` as the renderer hands it to an entry (`RenderFactorySlot`). */
export type RenderFactory = (
  name: string,
  props: object,
  // biome-ignore lint/suspicious/noExplicitAny: local Components receive the Factory's props
  options: { slots: Record<string, any>; fallback?: ReactNode },
) => ReactNode

/** One registered entry as `entriesOfSlot` lists it (registry.ts `StoredEntry`), as far as bot-core reads it. */
export interface SlotEntry {
  readonly component: unknown
  readonly store?: unknown
}

/** `ctx.slots`. */
export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: the slot runtime supplies the props
  register(options: Record<string, unknown>, component: ComponentType<any>): () => void
  /** The registered entries of a Slot; a single Slot lists only its head. */
  entriesOfSlot(key: string): readonly SlotEntry[]
  /** Called (microtask-batched) when a Slot's declaration or registrations change. */
  subscribe(key: string, listener: () => void): () => void
}
