/**
 * Where the Bots section mounts in the expanded sidebar.
 *
 * DSH has no slot between the panel list (Plugins, Automation tasks, More) and
 * the Workspaces section: `sidebar.workspaces` is a single slot whose owner
 * renders child slots only for its own registration, so it cannot be wrapped.
 * The section is therefore portaled into a container placed first in the
 * region that holds the Workspaces section — the last child of the sidebar's
 * `[data-sidebar-scrollport]` viewport, a marker the sidebar documents as
 * stable for integrations. When that layout is not found the caller renders
 * the section in its slot position instead (under New Session).
 */

export const SCROLLPORT_SELECTOR = "[data-sidebar-scrollport]"

/** The region element that holds the Workspaces section, if the layout matches. */
export function findRegion(root: ParentNode = document): HTMLElement | undefined {
  const port = root.querySelector(SCROLLPORT_SELECTOR)
  const region = port?.lastElementChild
  return region instanceof HTMLElement ? region : undefined
}

/**
 * Keep `host` as the first child of the Workspaces region, re-inserting it when
 * the sidebar re-renders that region.
 * @returns a disposer that removes the container and stops observing.
 */
export function keepFirstInRegion(host: HTMLElement, onLost: () => void): () => void {
  let port: Element | null = null
  const place = (): boolean => {
    const region = findRegion()
    if (region === undefined) return false
    if (host.parentElement !== region || region.firstElementChild !== host) region.prepend(host)
    return true
  }
  const observer = new MutationObserver(() => {
    if (!host.isConnected || host.parentElement?.firstElementChild !== host) {
      if (!place()) onLost()
    }
  })
  if (place()) {
    port = document.querySelector(SCROLLPORT_SELECTOR)
    if (port !== null) observer.observe(port, { childList: true, subtree: false })
    const region = host.parentElement
    if (region !== null) observer.observe(region, { childList: true })
  } else {
    onLost()
  }
  return () => {
    observer.disconnect()
    host.remove()
  }
}
