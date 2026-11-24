// A channel plugin reaches bot-core through its public entries only.
import { botOf } from "@1outres/dsh-bot-core"
import { TemplateDeclaration } from "@1outres/dsh-bot-core/template"

export const inject = ["bot"]
export function apply(ctx: never) {
  return [botOf(ctx).registerChannel({ id: "demo" }), TemplateDeclaration]
}
