import { createActionsModel } from "./approvals/actions-model"
import { createActionsHub } from "./approvals/hub"
import { watchWaiting } from "./approvals/waiting"
import { createBotDeletion } from "./bot-deletion"
import { createChannelQueries } from "./channel-queries"
import { createChannelsHub } from "./channels-hub"
import { createChannelsModel } from "./channels-model"
import { createConnectionsFeed, createConnectionsModel } from "./connections-model"
import { createConnectorsHub } from "./connectors-hub"
import { createConnectorsModel } from "./connectors-model"
import { createEnvironmentClient } from "./environment/client"
import { en, ja } from "./i18n"
import { createMainsClient } from "./mains/client"
import { watchManagedSessions } from "./managed-sessions"
import { createBotMenuOpener, registerBotMenu } from "./menu"
import { registerMenuIcons } from "./menu-icons"
import { createModelsHub, createModelsModel, modelCatalogReader } from "./models/feed"
import { createNoticeStore } from "./notices"
import { derive } from "./observable"
import { createSessionArchive } from "./session-archive"
import { snapshotOf } from "./session-classification"
import { createSessionMenuOpener } from "./session-menu"
import { createSettingChangesClient } from "./setting-changes/client"
import { createLockdownStatus } from "./sidebar/lockdown-status"
import { createSkillsClient } from "./skills/client"
import { mountBotCoreRemote, watchBots } from "./store"
import type { ClientContext } from "./types"
import { createBotVaultsHub, createVaultsFeed, openIncidentsOf } from "./vaults/model"
import { createVmHostClient } from "./vm-host/client"
import { createWebLookupFeed } from "./web/feed"
import { wireArchive } from "./wiring/archive"
import { createBotActions, createBotsFace, wireBotsSection } from "./wiring/bots-face"
import { wireClassification } from "./wiring/classification"
import { wireComposerSeats } from "./wiring/composer-seats"
import { wireConnectorPanels } from "./wiring/connector-panels"
import { createDialogStores, creationOptions, wireDialogs } from "./wiring/dialogs"
import { wireDrawer } from "./wiring/drawer"
import { wireDshSettings } from "./wiring/dsh-settings"
import { wireEnvironment } from "./wiring/environment"
import { wireFiles } from "./wiring/files"
import { wireGlobalSettings } from "./wiring/global-settings"
import { wireInteractions } from "./wiring/interactions"
import { createProgressView, wireLifecycle } from "./wiring/lifecycle"
import { wireMainView } from "./wiring/main-view"
import { wireMains } from "./wiring/mains"
import { wireNotes } from "./wiring/notes"
import { wireOnboarding } from "./wiring/onboarding"
import { wirePanels } from "./wiring/panels"
import { NAMESPACE } from "./wiring/plugin"
import { wireRightbar } from "./wiring/rightbar"
import { createSettingsScreens } from "./wiring/screens"
import { wireSettingChanges } from "./wiring/setting-changes"
import { wireSettings } from "./wiring/settings"
import { wireShell } from "./wiring/shell"
import { wireSkills } from "./wiring/skills"
import { wireStyles } from "./wiring/styles"
import { wireVmHost } from "./wiring/vm-host"
import { wireWebLookup } from "./wiring/web"
import { registerWorkspaceManagedMark, registerWorkspaceSessionMenu } from "./workspace-sessions"
import { watchWorkspaces } from "./workspaces"

export const inject = [
  "slots",
  "locale",
  "remote",
  "connection",
  "sessions",
  "workspaces",
  "uiWorkspace",
  "contextMenus",
  "uiSession",
  "layout",
]

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja }), "bot-core: dictionaries")

  const remote = mountBotCoreRemote(ctx)
  const bots = watchBots(remote, ctx.connection.generation)
  ctx.effect(() => () => bots.dispose(), "bot-core: bots store")
  wireStyles(ctx, bots)
  const waiting = watchWaiting(remote, ctx.connection.generation)
  ctx.effect(() => () => waiting.dispose(), "bot-core: waiting connector actions")
  const approvals = createActionsHub((botId) =>
    createActionsModel({ mount: remote, generation: ctx.connection.generation }, botId),
  )

  const connectors = createConnectorsHub((botId) =>
    createConnectorsModel({ mount: remote, generation: ctx.connection.generation }, botId),
  )
  const vaultDeps = { mount: remote, generation: ctx.connection.generation }
  const vaults = createVaultsFeed(vaultDeps)
  const logins = createBotVaultsHub(vaultDeps)
  const incidents = derive([vaults], openIncidentsOf)
  const progress = createProgressView()
  const classification = wireClassification(ctx, bots, progress)
  const notices = createNoticeStore()
  wireLifecycle(ctx, { bots, binding: classification.binding, progress, notices })
  const menu = createBotMenuOpener(ctx.contextMenus)
  ctx.effect(() => () => menu.dispose(), "bot-core: bot menu opener")
  const dialogs = createDialogStores()
  const mains = createMainsClient(remote)
  const actions = createBotActions(ctx, bots, progress, mains, notices)
  const managed = watchManagedSessions(remote, ctx.connection.generation, actions.status)
  ctx.effect(() => () => managed.dispose(), "bot-core: managed sessions")
  const workspaces = watchWorkspaces(remote, ctx.connection.generation)
  ctx.effect(() => () => workspaces.dispose(), "bot-core: Workspace grants")
  const workspaceSessions = { bots, workspaces: ctx.workspaces.list, grants: workspaces, managed }
  registerWorkspaceSessionMenu(ctx, workspaceSessions, ctx.locale.bind(NAMESPACE))
  registerWorkspaceManagedMark(ctx, workspaceSessions)
  const archive = createSessionArchive({
    workspace: ctx.uiWorkspace,
    sessions: ctx.sessions.list,
    status: actions.status,
    notices,
  })
  const screens = createSettingsScreens(dialogs)
  const deletion = createBotDeletion({
    removeBot: actions.removeBot,
    deleted: (botId) => screens.bot.flow.dismiss(botId),
  })

  const lockdown = createLockdownStatus()
  const files = wireFiles(ctx, {
    remote,
    bots,
    classify: classification.classify,
    linksAvailable: lockdown.linksAvailable,
  })
  wireRightbar(ctx, { classification, viewer: files.viewer, lockdown })
  wireInteractions(ctx, { remote, classification, managed })
  const rightbar = derive([lockdown], (status) => status.registration)
  const surfaces = wirePanels(ctx, {
    bots,
    classify: classification.classify,
    viewer: files.viewer,
  })
  const shell = wireShell(ctx, {
    classification,
    bots,
    rightbarRegistration: rightbar,
    files,
    notes: wireNotes(ctx, { remote, bots, classify: classification.classify }),
    openSettings: (botId, section) => screens.openSettings(botId, section),
    actions,
    progress,
    approvals,
    panels: surfaces.panels,
    popovers: surfaces.popovers,
    settingsStack: screens.stack,
    connectorPanels: wireConnectorPanels(ctx, { remote, connectors, surfaces }),
    incidents,
    mainView: wireMainView(ctx, { remote, bots, binding: classification.binding }),
  })

  const face = createBotsFace(ctx, {
    bots,
    registrations: { shell, rightbar, ...wireComposerSeats(ctx, classification.occupies) },
    actions,
    dialogs,
    screens,
    menu,
    sessionMenu: createSessionMenuOpener(ctx.contextMenus),
    archive,
    notices,
    progress,
    waiting,
    incidents,
    deletion,
    managed,
  })
  registerMenuIcons(ctx)
  registerBotMenu(ctx, face, ctx.locale.bind(NAMESPACE))
  wireArchive(ctx, { archive, notices, face })
  wireBotsSection(ctx, face)
  const readModelCatalog = modelCatalogReader(remote)
  const creation = {
    creationOptions: () => creationOptions(remote),
    modelCatalog: readModelCatalog,
  }
  wireDialogs(ctx, { dialogs, actions, creation })
  const connections = createConnectionsFeed(() => createConnectionsModel(remote))
  const webLookup = createWebLookupFeed(remote)
  const channelQueries = createChannelQueries(remote)
  wireSettings(ctx, {
    bots,
    screens,
    channels: createChannelsHub((botId) => createChannelsModel(remote, botId), channelQueries),
    connectors,
    connections,
    vaults,
    logins,
    models: createModelsHub((botId) =>
      createModelsModel({ mount: remote, generation: ctx.connection.generation }, botId),
    ),
    readCatalog: readModelCatalog,
    workspaces,
    actions,
    deletion,
  })
  wireMains(ctx, {
    mains,
    screens,
    startNewMain(botId) {
      const bot = snapshotOf(bots.getSnapshot())?.bots.find((item) => item.id === botId)
      if (bot !== undefined) void actions.startNewMain(bot)
    },
  })
  wireSkills(ctx, { skills: createSkillsClient(remote), screens })
  wireSettingChanges(ctx, { changes: createSettingChangesClient(remote), screens })
  wireEnvironment(ctx, { environment: createEnvironmentClient(remote), screens })
  wireWebLookup(ctx, webLookup, screens)
  wireVmHost(ctx, createVmHostClient(remote), screens)
  const onboarding = wireOnboarding(ctx, {
    remote,
    bots,
    progress,
    pending: actions.pending,
    creation,
    web: webLookup,
    connections,
    channelQueries,
  })
  wireGlobalSettings(ctx, screens)
  wireDshSettings(ctx, { openGlobalSettings: () => screens.openGlobalSettings() })
  wireDrawer(ctx, [
    dialogs.createDialog,
    dialogs.settings,
    dialogs.globalSettings,
    archive.confirming,
    deletion.asking,
    onboarding,
  ])
}
