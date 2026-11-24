import type { FileDelivery } from "./outlets"
import type { PresentedFile } from "./presented"
import type { PresentedFileResult, PresentedReport } from "./presented-delivery"

/** The notice that tells the Main session which presented files did not reach a channel. */
export interface PresentedNotice {
  readonly text: string
  readonly summary: string
}

const GUIDANCE =
  "They still show in the Web UI. Only a regular file inside your workspace and within a channel's size limit can be sent. " +
  "If the user needs a file that was outside your workspace, unreadable or too large, make it fit (for example, copy it into your workspace, compress or split it) and present the new file. " +
  "Do not present a file again unchanged: when a channel reported an error, or the environment was not ready, tell the user what did not arrive instead."

const quote = (value: string) => JSON.stringify(value)

const deliveryText = (delivery: FileDelivery) => {
  switch (delivery.outcome) {
    case "sent":
      return `sent to ${delivery.channelId}`
    case "too-large":
      return `not sent to ${delivery.channelId}: larger than its ${delivery.limit} byte limit`
    case "failed":
      return `not sent to ${delivery.channelId}: ${delivery.message}`
  }
}

const failed = (result: PresentedFileResult) =>
  result.kind === "unreadable" || result.deliveries.some((delivery) => delivery.outcome !== "sent")

const resultText = (result: PresentedFileResult) =>
  result.kind === "unreadable"
    ? `not sent: ${result.reason}`
    : result.deliveries.map(deliveryText).join("; ")

const line = (file: PresentedFile, text: string) => `- ${quote(file.path)}: ${text}`

function noticeOf(lines: readonly string[]): PresentedNotice {
  const count = lines.length
  const subject = count === 1 ? "1 file you presented" : `${count} files you presented`
  return {
    text: [
      `${subject} did not reach every chat channel connected to you:`,
      ...lines,
      GUIDANCE,
    ].join("\n"),
    summary: `${subject} did not reach every chat channel`,
  }
}

/** The notice a turn's report makes, or undefined when every file reached every channel. */
export function presentedNoticeOf(report: PresentedReport): PresentedNotice | undefined {
  const lines =
    report.kind === "environment-unavailable"
      ? report.files.map((file) =>
          line(file, "not sent: your environment was not ready, so the file could not be read"),
        )
      : report.results.filter(failed).map((result) => line(result.file, resultText(result)))
  return lines.length === 0 ? undefined : noticeOf(lines)
}
