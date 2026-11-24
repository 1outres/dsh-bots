import { Cron } from "@deepseek-ai/dsh-util-time"
import { parseDailyTime } from "../../shared/mains"

/**
 * The first instant after `after` whose local time in `timezone` is `time`
 * ("HH:MM"), through DSH's `Cron` (a nonexistent local time is skipped, a
 * repeated one is the earlier). Undefined when the search finds none.
 * @throws when the time or the zone is not usable.
 */
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
