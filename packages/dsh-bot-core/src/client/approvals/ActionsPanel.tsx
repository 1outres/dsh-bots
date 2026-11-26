import { type KeyboardEvent, useState } from "react"
import type { ConnectorText } from "../../shared/connectors"
import type { SenderInquiryView } from "../../shared/senders"
import { ConnectorRequests, requestsOf } from "../connector-panels/ConnectorRequests"
import type { ConnectorPanelPlaces } from "../connector-panels/places"
import type { ConnectorsFeed } from "../connectors-hub"
import type { PanelWidth } from "../files/panel-width"
import { useNow, useObservable } from "../hooks"
import { IconActions } from "../icons"
import { localeFormat } from "../locale-format"
import { InquiryCard } from "../senders/InquiryCard"
import type { InquiriesFeed } from "../senders/inquiries"
import { inquiryOutcome, inquiryTone } from "../senders/texts"
import { SidePanelFrame } from "../shell/SidePanelFrame"
import type { Translate } from "../types"
import { EmptyState, ErrorText, Group, NavRow, Row, StatusPill } from "../ui"
import { ActionCard, ActionDetails } from "./ActionCard"
import type { ActionsFeed } from "./hub"
import { actionsViewOf, actionTone, endedAt } from "./view"

export interface ActionsPanelProps {
  readonly t: Translate
  readonly text: (value: ConnectorText) => string
  readonly sessionId: string
  readonly feed: ActionsFeed
  readonly inquiries: InquiriesFeed
  readonly connectors: ConnectorsFeed
  readonly places: ConnectorPanelPlaces
  readonly width: PanelWidth
  readonly containerRef: { readonly current: HTMLElement | null }
  close(): void
}

export function ActionsPanel(props: ActionsPanelProps) {
  const { t, feed } = props
  const state = useObservable(feed)
  const asked = useObservable(props.inquiries)
  const inquiries = asked.status === "ready" ? asked.inquiries : []
  const requests = requestsOf(useObservable(props.connectors), props.text)
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    props.close()
  }
  return (
    <SidePanelFrame
      label={t("approvals.title")}
      title={t("approvals.title")}
      trailing={
        state.status === "ready" &&
        state.reconnecting && (
          <StatusPill
            tone="busy"
            label={t("approvals.reconnecting")}
            marks={{ "data-dshb-actions-reconnecting": "" }}
          />
        )
      }
      closeLabel={t("approvals.close")}
      resizeLabel={t("approvals.resize")}
      onClose={props.close}
      width={props.width}
      containerRef={props.containerRef}
      onKeyDown={onKeyDown}
      marks={{ "data-dshb-actions": "" }}
    >
      <div className="dshb-actions-body">
        <ConnectorRequests
          t={t}
          sessionId={props.sessionId}
          requests={requests}
          places={props.places}
        />
        {state.status === "loading" && <p className="dshb-panel-note">{t("files.loading")}</p>}
        {state.status === "failed" && (
          <ErrorText>{t("approvals.unavailable", { message: state.message })}</ErrorText>
        )}
        {asked.status === "failed" && (
          <ErrorText>{t("senders.page.unavailable", { message: asked.message })}</ErrorText>
        )}
        <InquiryList t={t} feed={props.inquiries} inquiries={inquiries} />
        {state.status === "ready" && (
          <ActionList
            t={t}
            feed={feed}
            empty={requests.length === 0 && inquiries.length === 0}
            actions={state.actions}
          />
        )}
      </div>
    </SidePanelFrame>
  )
}

function ActionList(props: {
  readonly t: Translate
  readonly feed: ActionsFeed
  readonly actions: Parameters<typeof actionsViewOf>[0]
  readonly empty: boolean
}) {
  const { t, feed } = props
  const now = useNow(true)
  const [expanded, setExpanded] = useState<string | undefined>(undefined)
  const view = actionsViewOf(props.actions)
  const format = localeFormat(t)
  if (view.open.length === 0 && view.history.length === 0) {
    return props.empty ? (
      <EmptyState
        icon={<IconActions size={28} />}
        title={t("approvals.empty")}
        marks={{ "data-dshb-actions-empty": "" }}
      />
    ) : null
  }
  return (
    <>
      {view.open.length > 0 && (
        <div className="dshb-actions-open" aria-live="polite">
          {view.open.map((action) => (
            <ActionCard key={action.id} t={t} action={action} now={now} decide={feed.decide} />
          ))}
        </div>
      )}
      {view.history.length > 0 && (
        <Group title={t("approvals.history")} marks={{ "data-dshb-actions-history": "" }}>
          {view.history.map((action) => {
            const open = expanded === action.id
            const at = endedAt(action.status) ?? action.createdAt
            return (
              <div key={action.id} className="dshb-actions-item" data-dshb-action={action.id}>
                <NavRow
                  density="compact"
                  label={action.preview.title}
                  meta={[
                    action.connector.name ?? action.connector.id,
                    format.relative(at, now, "largestUnit"),
                  ].join(" · ")}
                  trailing={
                    <StatusPill
                      tone={actionTone(action.status)}
                      label={t(`approvals.state.${action.status.state}`)}
                    />
                  }
                  expanded={open}
                  onOpen={() => setExpanded(open ? undefined : action.id)}
                />
                {open && <ActionDetails t={t} action={action} />}
              </div>
            )
          })}
        </Group>
      )}
    </>
  )
}

function InquiryList(props: {
  readonly t: Translate
  readonly feed: InquiriesFeed
  readonly inquiries: readonly SenderInquiryView[]
}) {
  const { t, feed } = props
  const now = useNow(true)
  const format = localeFormat(t)
  const open = props.inquiries.filter((inquiry) => inquiry.status.state === "pending")
  const closed = props.inquiries
    .filter((inquiry) => inquiry.status.state !== "pending")
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <>
      {open.length > 0 && (
        <div className="dshb-actions-open" aria-live="polite" data-dshb-sender-inquiries="">
          {open.map((inquiry) => (
            <InquiryCard key={inquiry.id} t={t} inquiry={inquiry} now={now} answer={feed.answer} />
          ))}
        </div>
      )}
      {closed.length > 0 && (
        <Group title={t("senders.inquiries")} marks={{ "data-dshb-sender-history": "" }}>
          {closed.map((inquiry) => (
            <Row
              key={inquiry.id}
              density="compact"
              label={t("senders.inquiry.title", { address: inquiry.address })}
              meta={[
                inquiryOutcome(t, inquiry),
                format.relative(inquiry.updatedAt, now, "largestUnit"),
              ]
                .filter((part) => part !== undefined)
                .join(" · ")}
              trailing={
                <StatusPill
                  tone={inquiryTone(inquiry)}
                  label={t(`senders.state.${inquiry.status.state}`)}
                />
              }
              marks={{ "data-dshb-sender-inquiry": inquiry.id }}
            />
          ))}
        </Group>
      )}
    </>
  )
}
