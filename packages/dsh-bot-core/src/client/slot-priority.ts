/**
 * The one priority bot-core registers at in every Slot seat it takes over for
 * bot sessions (`main.conversation`, `rightbar.session`,
 * `conversation.input.model`, `conversation.input.permission`,
 * `conversation.composer`): lower renders
 * (single Slots) or elects (chain Slots) first. DSH's entries sit at 0, and a
 * plugin replacing one of these seats everywhere sits below it (the `cordis`
 * tool's packages at -1, -2, …, @1outres/dsh-plugin-model-picker at -100), so
 * the seat's floor keeps every such replacement off bot sessions only. Finite,
 * as SlotCore orders entries by subtracting their priorities.
 */
export const BOT_SESSION_PRIORITY = Number.MIN_SAFE_INTEGER
