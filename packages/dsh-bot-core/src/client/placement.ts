export const SCROLLPORT_SELECTOR = "[data-sidebar-scrollport]"

export function findRegion(root: ParentNode = document): HTMLElement | undefined {
  const port = root.querySelector(SCROLLPORT_SELECTOR)
  const region = port?.lastElementChild
  return region instanceof HTMLElement ? region : undefined
}

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
