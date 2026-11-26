import type { Translate } from "../dsh/context"
import type { SidebarActions, SidebarNavigation, SidebarRightFace } from "../dsh/sidebar-right"
import { botFileTarget } from "../file-address"
import type { Viewer } from "../viewer"
import { BOT_FILE_TAB_KIND } from "./file-tab"
import { lineOf, planReviewOf, urlOf } from "./navigation-params"
import { BROWSER_KIND, PLAN_KIND, refusalKey, type SweepAction, type SweepPlan } from "./sweep-plan"

export interface SweepDeps {
  readonly sessionId: string
  readonly sidebar: SidebarRightFace
  readonly actions: SidebarActions
  readonly viewer: Viewer
  readonly openExternal: (url: string) => void
  readonly t: Translate
}

export interface SweepOutcome {
  readonly broken: boolean
}

export class NavigationUnavailableError extends Error {
  override readonly name = "NavigationUnavailableError"
}

function navigationOf(deps: SweepDeps, tabId: string): SidebarNavigation {
  try {
    return deps.sidebar.tabDomain.occurrence(deps.sessionId, { id: tabId }).navigation.getSnapshot()
  } catch (cause) {
    throw new NavigationUnavailableError(
      `the navigation of sidebar tab "${tabId}" cannot be read`,
      {
        cause,
      },
    )
  }
}

function refuse(deps: SweepDeps, tabKind: string): void {
  console.debug(`bot-core: a "${tabKind}" tab cannot open in a bot session; refused`)
  deps.viewer.notify(deps.sessionId, refusalKey(tabKind))
}

function route(action: SweepAction, deps: SweepDeps): void {
  const { sessionId, viewer } = deps
  switch (action.kind) {
    case "toggle":
      viewer.toggle(sessionId)
      return
    case "browse":
      viewer.browse(sessionId)
      return
    case "file": {
      const navigation = navigationOf(deps, action.tabId)
      const target = botFileTarget(navigation.address, (owner) => owner === sessionId)
      if (target === undefined) refuse(deps, BOT_FILE_TAB_KIND)
      else viewer.openFile(sessionId, target.path, lineOf(navigation.params))
      return
    }
    case "external": {
      const url = urlOf(navigationOf(deps, action.tabId).params)
      if (url === undefined) refuse(deps, BROWSER_KIND)
      else deps.openExternal(url)
      return
    }
    case "document": {
      const review = planReviewOf(navigationOf(deps, action.tabId).params)
      if (review === undefined) refuse(deps, PLAN_KIND)
      else viewer.showDocument(sessionId, review.title ?? deps.t("files.plan"), review.markdown)
      return
    }
    case "refused":
      refuse(deps, action.tabKind)
      return
  }
}

export function runSweep(plan: SweepPlan, deps: SweepDeps): SweepOutcome {
  let broken = false
  for (const action of plan.actions) {
    try {
      route(action, deps)
    } catch (error) {
      if (error instanceof NavigationUnavailableError) broken = true
      console.error(`bot-core: routing a "${action.kind}" sidebar open failed`, error)
    }
  }
  for (const tabId of plan.close) {
    try {
      deps.sidebar.closeIn(deps.sessionId, tabId)
    } catch (error) {
      console.error("bot-core: closing a stock sidebar tab failed", error)
    }
  }
  if (plan.collapse) {
    try {
      deps.actions.setExpanded(deps.sessionId, false)
    } catch (error) {
      console.error("bot-core: collapsing the stock sidebar failed", error)
    }
  }
  return { broken }
}
