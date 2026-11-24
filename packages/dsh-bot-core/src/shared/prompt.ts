/**
 * What bot-core takes out of every bot Agent's prompt: DSH's guidance for a
 * person working on DSH itself in its Web GUI, and permission facts a bot has
 * no use for (its permission is fixed, see permission.ts). Names are those
 * DSH's providers register with `systemPrompt.section` / `systemPrompt.context`.
 */
export interface PromptExclusions {
  /** System prompt sections. */
  readonly sections: readonly string[]
  /** Runtime-context contributions. */
  readonly contexts: readonly string[]
}

export const BOT_PROMPT_EXCLUSIONS: PromptExclusions = {
  sections: [
    // dsh-harness-dev-context: the DSH checkout and the Web GUI with its HMR.
    "harness:source",
    "app:web-surface",
    // dsh-deliverable-file-references: the present tool, which bots do not have.
    "ui:deliverable-file-references",
  ],
  contexts: [
    // dsh-sandbox-policy, dsh-user-approval.
    "sandbox:policy",
    "approval:policy",
    // dsh-harness-dev-context.
    "harness:source",
    "app:web-surface",
  ],
}
