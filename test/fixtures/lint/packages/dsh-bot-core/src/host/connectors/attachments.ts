declare const connector: { attachment: { open(): Promise<unknown> } }

export function open() {
  return connector.attachment.open()
}
