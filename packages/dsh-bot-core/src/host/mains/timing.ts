import { Cron } from "@deepseek-ai/dsh-util-time"
import { parseDailyTime } from "../../shared/mains"

export function dailyBoundaryAfter(
  time: string,
  timezone: string,
  after: number,
): number | undefined {
  const { hour, minute } = parseDailyTime(time)
  const parsed = Cron.parse(`${minute} ${hour} * * *`, timezone)
  if (parsed.kind === "rejected") throw new Error(parsed.detail)
  const next = parsed.rule.next(after)
  return next === undefined ? undefined : Date.parse(next)
}
