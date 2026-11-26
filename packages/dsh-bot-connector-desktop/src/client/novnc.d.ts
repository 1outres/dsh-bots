declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | object, options?: { shared?: boolean })
    viewOnly: boolean
    scaleViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    qualityLevel: number
    compressionLevel: number
    background: string
    focus(): void
    blur(): void
    disconnect(): void
    sendCtrlAltDel(): void
  }
}
