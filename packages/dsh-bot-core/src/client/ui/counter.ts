const COUNTER_FROM = 0.8

export function counterShown(focused: boolean, length: number, maxLength: number | undefined) {
  return focused && maxLength !== undefined && length >= maxLength * COUNTER_FROM
}
