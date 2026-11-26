import type { ComponentType, ReactNode } from "react"

export const SLOT = {
  sessionAction: "sidebar.session.action",
  shellOverlay: "shell.overlay",
  mainConversation: "main.conversation",
  conversationSession: "conversation.session",
  conversationComposer: "conversation.composer",
  inputModel: "conversation.input.model",
  inputPermission: "conversation.input.permission",
  sessionHeaderCorner: "conversation.session.header.corner",
  rightbarSession: "rightbar.session",
  sidebarRightTab: "sidebar.right.pane.tab",
  settingsSection: "settings.section",
  panelList: "sidebar.panellist",
  main: "main",
} as const

export type SlotName = (typeof SLOT)[keyof typeof SLOT]

export const FACTORY = {
  conversationContent: "conversation.content",
  filesTree: "sidebar.files.tree",
} as const

export type FactoryName = (typeof FACTORY)[keyof typeof FACTORY]

export type RenderFactory = (
  name: string,
  props: object,
  // biome-ignore lint/suspicious/noExplicitAny: -
  options: { slots: Record<string, any>; fallback?: ReactNode },
) => ReactNode

export interface SlotEntry {
  readonly component: unknown
  readonly store?: unknown
}

export interface SlotsService {
  inject(key: string, register: () => () => void): () => void
  // biome-ignore lint/suspicious/noExplicitAny: -
  register(options: Record<string, unknown>, component: ComponentType<any>): () => void
  entriesOfSlot(key: string): readonly SlotEntry[]
  subscribe(key: string, listener: () => void): () => void
}
