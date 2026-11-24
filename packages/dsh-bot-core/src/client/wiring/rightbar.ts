import type { SidebarRightFace, SidebarRightTabsFace } from "../dsh/sidebar-right"
import { SLOT, type SlotsService } from "../dsh/slots"
import type { Observable } from "../observable"
import { BOT_FILE_TAB_ID, botFileTabDefinition } from "../sidebar/file-tab"
import type { LockdownStatusStore } from "../sidebar/lockdown-status"
import { RefusedFileTab } from "../sidebar/RefusedFileTab"
import {
  type RightbarStore,
  SessionRightbar,
  type SessionRightbarFace,
} from "../sidebar/SessionRightbar"
import { cornerStoreHandle, type StoreHandle } from "../sidebar/store-handle"
import { createSlotRegistration, type SlotRegistration } from "../slot-registration"
import type { ClientContext } from "../types"
import type { Viewer } from "../viewer"
import type { Classification } from "./classification"
import { NAMESPACE } from "./plugin"

export interface RightbarSources {
  readonly classification: Classification
  readonly viewer: Viewer
  readonly lockdown: LockdownStatusStore
}

const SIDEBAR_SERVICES = ["sidebarRight", "sidebarRightTabs"] as const

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer")
}

const injected = (face: SessionRightbarFace, handle: RightbarStore["handle"]) => ({
  ...face,
  handle,
})

/** The `rightbar.session` registration options for one store handle; DSH hands the store props only with `store`. */
function rightbarOptions(handle: StoreHandle, priority: number, face: SessionRightbarFace) {
  const base = { name: SLOT.rightbarSession, priority, locale: NAMESPACE }
  switch (handle.state) {
    case "present":
      return { ...base, store: handle.store, inject: () => injected(face, "present") }
    case "missing":
      return { ...base, inject: () => injected(face, "missing") }
  }
}

/**
 * Hold the lockdown registration with the corner's current store handle:
 * a new handle (DSH re-registering its seat) re-registers it, a refusal is final.
 */
function holdLockdown(
  slots: SlotsService,
  wanted: Observable<boolean>,
  face: SessionRightbarFace,
  lockdown: LockdownStatusStore,
): () => void {
  const handles = cornerStoreHandle(slots)
  const register = (handle: StoreHandle) => {
    lockdown.setHandle(handle.state)
    const registration = createSlotRegistration({
      wanted,
      label: "right sidebar lockdown",
      register: (priority) =>
        slots.register(rightbarOptions(handle, priority, face), SessionRightbar),
    })
    const report = () => lockdown.setRegistration(registration.getSnapshot())
    report()
    const off = registration.subscribe(report)
    return {
      registration,
      release() {
        registration.dispose()
        report()
        off()
      },
    }
  }
  let current: { readonly registration: SlotRegistration; release(): void } = register(
    handles.getSnapshot(),
  )
  const offHandles = handles.subscribe(() => {
    const handle = handles.getSnapshot()
    if (current.registration.getSnapshot().state === "refused") {
      lockdown.setHandle(handle.state)
      return
    }
    current.release()
    current = register(handle)
  })
  return () => {
    offHandles()
    current.release()
  }
}

/**
 * The right sidebar lockdown of bot sessions and the routing of what opens
 * there into the bot file viewer, while DSH's right sidebar is loaded
 * (README: Bot file viewer and right sidebar lockdown).
 */
export function wireRightbar(ctx: ClientContext, sources: RightbarSources): void {
  const { classification, lockdown } = sources
  ctx.inject(SIDEBAR_SERVICES, (sidebarCtx) => {
    // Read as the injected properties (design rule 8 keeps ctx.get to store.ts).
    const sidebar = sidebarCtx.sidebarRight as SidebarRightFace
    const tabs = sidebarCtx.sidebarRightTabs as SidebarRightTabsFace
    sidebarCtx.effect(
      () => tabs.register(botFileTabDefinition(classification.classify)),
      "bot-core: bot file tab type",
    )
    sidebarCtx.effect(
      () =>
        sidebarCtx.slots.inject(SLOT.sidebarRightTab, () =>
          sidebarCtx.slots.register(
            { name: SLOT.sidebarRightTab, key: BOT_FILE_TAB_ID, locale: NAMESPACE },
            RefusedFileTab,
          ),
        ),
      "bot-core: refused bot file tab body",
    )
    const face: SessionRightbarFace = {
      sidebar,
      viewer: sources.viewer,
      classify: classification.classify,
      lockdown,
      openExternal,
    }
    sidebarCtx.effect(
      () =>
        sidebarCtx.slots.inject(SLOT.rightbarSession, () =>
          holdLockdown(sidebarCtx.slots, classification.occupies, face, lockdown),
        ),
      "bot-core: right sidebar lockdown for bot sessions",
    )
  })
}
