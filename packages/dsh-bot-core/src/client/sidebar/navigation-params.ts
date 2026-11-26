export interface PlanReview {
  readonly title: string | undefined
  readonly markdown: string
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined
}

export function lineOf(params: unknown): number | undefined {
  const line = recordOf(params)?.line
  return typeof line === "number" && Number.isFinite(line) ? line : undefined
}

export function urlOf(params: unknown): string | undefined {
  const url = recordOf(params)?.url
  return typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined
}

export function planReviewOf(params: unknown): PlanReview | undefined {
  const review = recordOf(recordOf(params)?.planReview)
  if (typeof review?.markdown !== "string") return undefined
  const title = typeof review.title === "string" && review.title !== "" ? review.title : undefined
  return { title, markdown: review.markdown }
}
