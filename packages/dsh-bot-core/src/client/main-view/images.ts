import type { MainViewClient } from "./client"

export interface TimelineImages {
  load(botId: string, sessionId: string, attachmentId: string): Promise<string>
  dispose(): void
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index)
  return bytes
}

export function createTimelineImages(client: Pick<MainViewClient, "image">): TimelineImages {
  const urls = new Map<string, Promise<string>>()
  const made = new Set<string>()
  return {
    load(botId, sessionId, attachmentId) {
      const known = urls.get(attachmentId)
      if (known !== undefined) return known
      const loading = client.image(botId, sessionId, attachmentId).then((image) => {
        const url = URL.createObjectURL(new Blob([bytesOf(image.data)], { type: image.mediaType }))
        made.add(url)
        return url
      })
      urls.set(attachmentId, loading)
      loading.catch(() => {
        if (urls.get(attachmentId) === loading) urls.delete(attachmentId)
      })
      return loading
    },
    dispose() {
      for (const url of made) URL.revokeObjectURL(url)
      made.clear()
      urls.clear()
    },
  }
}
