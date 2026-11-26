export interface Choice<Value extends string> {
  readonly value: Value
  readonly label: string
  readonly title?: string
  readonly group?: string
  readonly disabled?: boolean
}

export function stepChoice(
  choices: readonly { readonly disabled?: boolean }[],
  index: number,
  key: string,
): number | undefined {
  const enabled = choices.flatMap((choice, at) => (choice.disabled === true ? [] : [at]))
  if (enabled.length === 0) return undefined
  if (key === "Home") return enabled[0]
  if (key === "End") return enabled.at(-1)
  const step =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0
  if (step === 0) return undefined
  const count = choices.length
  for (let offset = 1; offset <= count; offset += 1) {
    const at = (((index + step * offset) % count) + count) % count
    if (choices[at]?.disabled !== true) return at
  }
  return undefined
}

export function groupChoices<Value extends string>(
  choices: readonly Choice<Value>[],
): readonly { readonly group: string | undefined; readonly choices: readonly Choice<Value>[] }[] {
  const runs: { group: string | undefined; choices: Choice<Value>[] }[] = []
  for (const choice of choices) {
    const last = runs.at(-1)
    if (last !== undefined && last.group === choice.group) last.choices.push(choice)
    else runs.push({ group: choice.group, choices: [choice] })
  }
  return runs
}

const normalized = (text: string) => text.toLowerCase().replaceAll("_", " ")

export function searchChoices<Value extends string>(
  choices: readonly Choice<Value>[],
  query: string,
): readonly Choice<Value>[] {
  const words = normalized(query)
    .split(/\s+/)
    .filter((word) => word !== "")
  if (words.length === 0) return choices
  return choices.filter((choice) => {
    const haystack = `${normalized(choice.label)} ${normalized(choice.value)} ${normalized(choice.group ?? "")}`
    return words.every((word) => haystack.includes(word))
  })
}
