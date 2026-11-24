/**
 * DSH sources the bot session shell and its right-sidebar lockdown copy (markup, behavior or CSS), or
 * whose behavior or DOM it relies on, because `client/` may not import
 * `@deepseek-ai/dsh-client-ui-*` (design rule 30). Written against DSH
 * 0.2.2-rc.5, the only DSH version the packages accept (`engines.dsh`).
 * `test/shell-upstream.test.ts` compares each file of the repository's root
 * devDependencies (pinned at this version) with its SHA-256 here; raising the
 * version fails until the shell is re-checked (the copy re-synced) and the
 * hashes updated.
 */
export const UPSTREAM_DSH_VERSION = "0.2.2-rc.5"

export interface UpstreamFile {
  readonly package: string
  /** Relative to the package directory. */
  readonly path: string
  readonly sha256: string
  /** What bot-core copies from it or relies on. */
  readonly reason: string
  /** bot-core files (under src/client/) that copy or rely on it. */
  readonly reliedOnBy: string
}

export const UPSTREAM_FILES: readonly UpstreamFile[] = [
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/skeleton/ConversationMainPanel.tsx",
    sha256: "d3af01d2d999d36c224bb124bad6b27f0371bd0932979237a51b00b19d9d9d05",
    reason: "phase and hero derivation of the main panel",
    reliedOnBy: "shell-phase.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/contract/snapshot.ts",
    sha256: "0c2abe05175c503093ae1e4c94ff85acf3f613df913bf68a0611fbc9e525abb7",
    reason: "conversationPhase",
    reliedOnBy: "shell-phase.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/skeleton/ConversationWidthControls.tsx",
    sha256: "b9ff87700b86826da6a1702b681b8dcac636b7ca43f1d3a7942bb6d4ad724fd5",
    reason: "width handles",
    reliedOnBy: "ShellWidthControls.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/skeleton/ConversationRoot.module.css",
    sha256: "61b52c8daf686e98e379cb4f671ccee063ebace923cdbc15e88b6304078377e2",
    reason: ".root and width-handle rules",
    reliedOnBy: "styles-shell.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/skeleton/ConversationContent.tsx",
    sha256: "7186bfddd4247173db76f407526f63bd206e383a8b257ab9e3347be2de57e93e",
    reason:
      "content Factory markup (data-conversation-scroll, data-composer-seat, hero composer) and its views/widthControls positions",
    reliedOnBy: "styles-shell.ts, shell/BotSessionShell.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/skeleton/DefaultConversationViews.tsx",
    sha256: "c4d76f4860134df110df58963778669a37ebbc1a4f42b1acf165b20304db2e01",
    reason: "the view area under the conversation.session anchor",
    reliedOnBy: "styles-shell.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/apply.ts",
    sha256: "e7e605c7b5a1ea5383236397ac39d3d2cf4f5214028b7bde35a711cdf50f6540",
    reason:
      "ConversationRoot registered in main.conversation at the default priority, declaring conversation.header; the conversation.content Factory",
    reliedOnBy: "wiring/shell.ts, slot-priority.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/contract/slots.ts",
    sha256: "6f193dc25809173d1047ac2ca7c4abff7a49f355c17467234addf2bd1ea55da4",
    reason:
      "main.conversation and conversation.content props; conversation.input.model and conversation.input.permission, the composer's single session-scoped model and permission seats",
    reliedOnBy: "dsh/conversation.ts, shell/BotSessionShell.tsx, wiring/composer-seats.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-conversation",
    path: "src/client/skeleton/InputBar.tsx",
    sha256: "6832d81a8c45e515a41a0ef481b70441f433f26d1e858ac2647ab5dd8adb52a7",
    reason:
      "the composer tool row renders the conversation.input.model and conversation.input.permission seats (and nothing in their place when they are empty)",
    reliedOnBy: "wiring/composer-seats.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-model-selection",
    path: "src/client/index.ts",
    sha256: "989435b6b350cbbdd9e1b57cbaf9cc9c70a4969d40e24345ad2a8c5f1f9f7e46",
    reason:
      "the model picker's two entries: the conversation.input.model seat (registered without a priority, so at 0, where a plugin replacing the picker shadows it from below and BOT_SESSION_PRIORITY shadows both) and the /model command contribution",
    reliedOnBy: "wiring/composer-seats.ts, slot-priority.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-permission-presets",
    path: "src/client/index.ts",
    sha256: "8820e7bfc0b519fb866dec3d9a335bcd4adc0471ee95ffee2fd4ac170d906e61",
    reason:
      "the permission selector's two entries: the conversation.input.permission seat (registered without a priority, so at 0, where BOT_SESSION_PRIORITY shadows it) and the /permission command decoration",
    reliedOnBy: "wiring/composer-seats.ts, slot-priority.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-chat",
    path: "src/client/apply.ts",
    sha256: "3f2824757df3fd343f3032a8d98b5f28e53b31e94ced7c56c9d3ac895ed0e424",
    reason:
      "the Chat view id \"chat\"; file links open fileAddressFor(...) with params.line; external links openTab('browser', { params: { url } }) in 'sidebar' mode",
    reliedOnBy: "shell/BotSessionShell.tsx, sidebar/sweep-run.ts, sidebar/navigation-params.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-subagent",
    path: "src/client/sidebar-chat/index.tsx",
    sha256: "3fd8c634e5cc7b3d87062b88571a9f67b8fb57ea32837d99fecebd260901a3f3",
    reason: "FixedChatConversationView: the Chat-only views position",
    reliedOnBy: "shell/BotSessionShell.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-session",
    path: "src/client/index.ts",
    sha256: "41f9e5fc5451d482812dd2f6f5044a92d5571a061d50c8baffa2d4308c610f2d",
    reason: "uiSession.adapter.current, the main binding",
    reliedOnBy: "main-session.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-workspace",
    path: "src/client/navigation.ts",
    sha256: "f9a65b9e80b892219faf1be20631199f9be4f2348a31251167f309e3abcb7018",
    reason:
      "the saved selection is restored only once the session and Workspace lists are ready (watchNavigation), synchronously for a non-blank or Workspace-less session",
    reliedOnBy: "main-session.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-connection",
    path: "src/client/index.ts",
    sha256: "b508d7ab09e83685336d1e9d3649f4c9cf77ca7825835069201b04a66e60c31d",
    reason:
      "ctx.connection.generation: undefined while reconnecting, a new value once re-established",
    reliedOnBy: "dsh/connection.ts, store.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-renderer",
    path: "src/client/bindings.tsx",
    sha256: "ceaf302fcb4eb4ec419fc92c5b39f3667d753e67584dffbaf4540a67fc4f6672",
    reason: "ScopeProvider binds the session scope from adapter.current",
    reliedOnBy: "main-session.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-renderer",
    path: "src/client/scoped-slots.tsx",
    sha256: "7f348afba3e4aa2882ee50c7a18800fe03c606bb87b61e02ee64b99d919450a1",
    reason:
      "renderSlot child authorization, [data-slot] anchors, session-maybe remount per session",
    reliedOnBy: "slot-registration.ts, styles-shell.ts, shell/BotSessionShell.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/index.ts",
    sha256: "eee93e35d2972e562f4e33f9ed5c35c1c1d16625a8beb0e64bfcb6954d973925",
    reason:
      "rightbar.session registered with the sidebar store (its handle), children and inject; shortcut and seat wiring",
    reliedOnBy: "wiring/rightbar.ts, sidebar/store-handle.ts, sidebar/SessionRightbar.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/service.ts",
    sha256: "b6b80c393ca67dc46b5854dad63a34a68000cab20b3fd65ad2cc1ed55c2329e9",
    reason:
      "openResource/openTab require() an adopted store; commandTarget/toggleExpanded; closeIn; tabDomain",
    reliedOnBy: "sidebar/sweep-run.ts, sidebar/SessionRightbar.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/stores.ts",
    sha256: "1f3277b5bb3457efedae5b55cb1823de9344d40f75a4df81618b12585122b0f6",
    reason:
      "SidebarRightState/SurfaceState shape, actions open and setExpanded, the sole-guide close rule",
    reliedOnBy: "sidebar/sweep-plan.ts, sidebar/SessionRightbar.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/tab-registry.ts",
    sha256: "5b58415daec7f9202bab494516bd20542ca938fbecef70b187414ac59b8b92d2",
    reason: "tab type definition, bands, patterns and canOpen",
    reliedOnBy: "sidebar/file-tab.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/tab-domain.ts",
    sha256: "16c4e766051bb37e9c94bfe438ec12f7525fc683f97342185ddd42f08c105b46",
    reason: "occurrence(...).navigation: a tab's address and params",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/contract/slots.ts",
    sha256: "a6ef85dd2b5861b00467c8994c640356e346ea47e06ec67e95f291197a716ad9",
    reason: "rightbar.session owner props; sidebar.right.pane.tab body hook (useTabInfo)",
    reliedOnBy: "sidebar/SessionRightbar.tsx, sidebar/RefusedFileTab.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/contract/seed.ts",
    sha256: "28c2cd8e27288df34f0953c507086c779c2ae326b47766756203b3561c513240",
    reason: "the guide kind and page addresses (the default page an expansion seeds)",
    reliedOnBy: "sidebar/sweep-plan.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/shell/RightbarRoot.tsx",
    sha256: "1175fdf2dca59cee64e4e37d6eef3773998cc40166fbd7fe5002693bdfbe9a3a",
    reason: "every Session view renders through the one rightbar.session slot",
    reliedOnBy: "wiring/rightbar.ts, sidebar/SessionRightbar.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/shell/SidebarRight.tsx",
    sha256: "3b55707af33c14d575d74b35335ad64a5607de425063548f28db3af11ab15a56",
    reason: "the stock seat closes the frame track when it stops being active",
    reliedOnBy: "wiring/rightbar.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/session-views.ts",
    sha256: "f59c4639d00002cfe38095784e15b94261cf5eeb39ab9e1f8690589df51c73da",
    reason: "which background Session views are retained (keepMounted tabs only)",
    reliedOnBy: "wiring/rightbar.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/shortcuts.ts",
    sha256: "c2d13eaf2c8b81e4e26a489fcc249f0ef07b1ab03e60faa494e2564be48b2c4a",
    reason: "sidebar.right.toggle acts through the controller",
    reliedOnBy: "sidebar/sweep-plan.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-terminal",
    path: "src/client/index.ts",
    sha256: "0172d00b680623936444e79f21eeffd10b4cbd90993158998b07dbb2fafedea9",
    reason: "terminal.new opens a tab through the controller; the close handler",
    reliedOnBy: "sidebar/sweep-plan.ts",
  },
  {
    package: "@deepseek-ai/dsh-api-terminal-controller",
    path: "src/client/index.ts",
    sha256: "e5f361aed6809a0feedbc1e07375257e3976b7d520be6b41aab3264d5858505f",
    reason: "a PTY starts only when a terminal body mounts (view), not for a swept tab",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-files",
    path: "src/client/index.ts",
    sha256: "ae10ccbadea5768fb7c887a1a3d31b8963d5dc3c638434d07636bff73506f358",
    reason:
      "workspace.files opens the files page through the controller; the tree Factory registration",
    reliedOnBy: "sidebar/sweep-plan.ts, files/FileTreeView.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-files",
    path: "src/client/FileTree.tsx",
    sha256: "df51316fb0d8eb147b0877b42e3755036680e708da93b64e93da411f8f8eec6b",
    reason: "sidebar.files.tree Factory input (FileTreeInput, current and currentRef)",
    reliedOnBy: "dsh/sidebar-files.ts, files/FileTreeView.tsx, files/BrowseView.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-documentpreview",
    path: "src/client/TextPreview.module.css",
    sha256: "d67a94d5dc0bb4a816ff01b702b79ebde740cd21a4a9bcd5a7489d98a558882c",
    reason: "the navigated line's mark token (.lineMark)",
    reliedOnBy: "styles-files.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-browser",
    path: "src/client/index.ts",
    sha256: "ec48d63211ecdd0e386787402aee6c4e1f387c562e5c5b2f1da63672731824d4",
    reason: "the browser kind and its { url } params",
    reliedOnBy: "sidebar/navigation-params.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-plan",
    path: "src/client/index.ts",
    sha256: "cc36cca800a2d9f4bf041985c2bb89c33e8f661d029e47dc37ed64c0365633d4",
    reason: "the plan kind and plan-review { planReview: { markdown, title } } params",
    reliedOnBy: "sidebar/navigation-params.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-reference",
    path: "src/client/index.ts",
    sha256: "c450a2f2a3f9b6e8054c85fbb4ed3b1f575590750c570c2f7e1698aa149c9b34",
    reason: "@-file chips open fileAddressFor(...) through openResource",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-util-workspace-path",
    path: "src/file-address.ts",
    sha256: "e54979d7970c09a777d9917a098ab0de8768c60dd198a97167480ffde9bc8f7c",
    reason: "parseFileAddress (copied)",
    reliedOnBy: "file-address.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-renderer",
    path: "src/client/registry.ts",
    sha256: "6b8b6b969d8bcf0314ea20438a223f3a90e1bd516571faecae5c3c01008ecf21",
    reason:
      "entriesOfSlot returns entries with their store; store instances minted per scope on render; a registration's numeric priority, its chain ordering too",
    reliedOnBy: "sidebar/store-handle.ts, wiring/rightbar.ts, slot-priority.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/focus.ts",
    sha256: "9f9147ba941389b22162a718863a3a1bcb2812fcfb34e2c8224898f85c04534d",
    reason:
      "commandTarget/focusedTarget: shortcuts find a target only while the session has a surface",
    reliedOnBy: "sidebar/SessionRightbar.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-sidebar-right",
    path: "src/client/persistence.ts",
    sha256: "b080ae7b49ce1a609d4ad9fe0561a9450c88eef69928db9bad8d89f057dcf7c6",
    reason: "the layout restored per session at store creation (closed unopened by the sweep)",
    reliedOnBy: "sidebar/sweep-plan.ts, sidebar/SessionRightbar.tsx",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-open-in-app",
    path: "src/client/context-menus.tsx",
    sha256: "433db851b27a586b81aaa600a5a2311529be81f88aba322e077d7578f351bab1",
    reason:
      "the file context menu opens previews with openResourceIn (routed) and acts on Host paths (not routed; README known limits)",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-deliverables",
    path: "src/client/index.ts",
    sha256: "ece5a10b76e29a27a697dcd54d8cb65189fb8f8aedb8b43f0be0442b561db3db",
    reason:
      "deliverable cards open files through the chat openFile (routed); changes review opens its own resource (refused)",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-deliverables",
    path: "src/client/Deliverables.tsx",
    sha256: "3d7d7512f7da17a8918f4cd40d856828770472319102aaadb79ba83a20dd8e6c",
    reason: "a card body click previews through openFile; presented-file open/reveal does not",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-ui-skill",
    path: "src/client/index.ts",
    sha256: "8446f1aca498bb4f7af7133f6022b77a3ce772d98ec4fc736d1e4084cf8d58fb",
    reason: "skill file links open fileAddressFor(...) through openResource",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
  {
    package: "@deepseek-ai/dsh-client-resources",
    path: "src/client/resources.ts",
    sha256: "29af779c2234060d731dde6d78dde5d80897377fd6bfef8873e0a33f988ab46a",
    reason:
      "pin() opens the provider stream at once (a Host stat for a routed bot file address; README)",
    reliedOnBy: "sidebar/sweep-run.ts",
  },
]
