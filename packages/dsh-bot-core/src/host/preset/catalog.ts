import type { BotTemplate } from "../../shared/preset"
import { templateProblem } from "./compose"
import type { TemplateCatalog } from "./types"

export interface TemplateCatalogDeps {
  /** Report a subscriber that threw; the other subscribers still run. Defaults to ignoring it. */
  warn?(message: string): void
}

/**
 * In-memory template catalog. Registering validates the template with
 * {@link templateProblem} and mounts nothing; the catalog keeps the object it
 * was given (the caller must not mutate it afterwards), `!!js` nodes in its
 * rows included.
 */
export function createTemplateCatalog(deps: TemplateCatalogDeps = {}): TemplateCatalog {
  // Each registration gets its own record, so a stale disposer never removes a
  // later registration of the same id, even of the same template object.
  const templates = new Map<string, { readonly template: BotTemplate }>()
  const listeners = new Set<(templateId: string) => void>()

  const publish = (templateId: string) => {
    for (const listener of [...listeners]) {
      try {
        listener(templateId)
      } catch (error) {
        deps.warn?.(`bot-core: a template listener failed for "${templateId}": ${String(error)}`)
      }
    }
  }

  return {
    register(template) {
      const problem = templateProblem(template)
      if (problem !== undefined) throw new Error(problem)
      if (templates.has(template.id)) {
        throw new Error(`bot template "${template.id}" is already registered`)
      }
      const record = { template }
      templates.set(template.id, record)
      publish(template.id)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        if (templates.get(template.id) !== record) return
        templates.delete(template.id)
        publish(template.id)
      }
    },

    get: (id) => templates.get(id)?.template,

    list: () =>
      [...templates.values()]
        .map((record) => record.template)
        .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),

    subscribe(listener) {
      // Wrap so subscribing one function twice yields two independent subscriptions.
      const entry = (templateId: string) => listener(templateId)
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
  }
}
