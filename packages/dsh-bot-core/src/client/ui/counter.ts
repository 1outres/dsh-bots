/** The share of `maxLength` from which a focused field shows its counter. */
const COUNTER_FROM = 0.8

/** Whether a field shows its `length/maxLength` counter: while focused and near its limit. */
export function counterShown(focused: boolean, length: number, maxLength: number | undefined) {
  return focused && maxLength !== undefined && length >= maxLength * COUNTER_FROM
}
