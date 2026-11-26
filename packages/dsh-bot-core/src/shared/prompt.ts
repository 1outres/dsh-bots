export interface PromptExclusions {
  readonly sections: readonly string[]
  readonly contexts: readonly string[]
}

export const BOT_PROMPT_EXCLUSIONS: PromptExclusions = {
  sections: ["harness:source", "app:web-surface", "ui:deliverable-file-references"],
  contexts: ["sandbox:policy", "approval:policy", "harness:source", "app:web-surface"],
}
