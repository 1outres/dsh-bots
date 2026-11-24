import type { PromptExclusions } from "../../shared/prompt"

interface Named {
  readonly name: string
}

/** The part of dsh-system-prompt's `PromptPresentation` exclusions apply to. */
export interface PromptParts<S extends Named, C extends Named> {
  readonly sections: readonly S[]
  readonly contexts: readonly C[]
}

/** The presentation without the excluded sections and contexts; everything else unchanged. */
export function withoutExcluded<S extends Named, C extends Named, P extends PromptParts<S, C>>(
  presentation: P,
  exclusions: PromptExclusions,
): P {
  return {
    ...presentation,
    sections: presentation.sections.filter(
      (section) => !exclusions.sections.includes(section.name),
    ),
    contexts: presentation.contexts.filter(
      (context) => !exclusions.contexts.includes(context.name),
    ),
  }
}
