import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useObservable, useOptionalObservable } from "../hooks"
import { IconChevronLeft, IconChevronRight } from "../icons"
import { barKey } from "../shell/ShellMenuBar"
import type { Translate } from "../types"
import { BackRow } from "../ui/BackRow"
import { Button } from "../ui/Button"
import { focusHome } from "../ui/layers"
import type { DataMarks } from "../ui/marks"
import { OverlayFrame, OverlayTitle } from "../ui/OverlayFrame"
import { PendingEditsContext } from "../ui/pending-edits"
import { useCompactLayout } from "../ui/viewport"
import { DiscardConfirm, StepConfirm } from "./confirmations"
import type { FrameControls, FrameTarget } from "./flow"
import type { FrameSection, FrameSectionProps, SettingsBadge } from "./sections"

export interface FrameHeading {
  readonly leading: ReactNode
  readonly title: string
}

export type FrameView<Props extends FrameSectionProps, Subject> =
  | { readonly kind: "section"; readonly section: FrameSection<Props, Subject> }
  | { readonly kind: "empty"; readonly message: ReactNode }

export interface SettingsFrameProps<Props extends FrameSectionProps, Subject> {
  readonly t: Translate
  readonly controls: FrameControls
  readonly target: FrameTarget
  readonly heading: FrameHeading
  readonly sections: readonly FrameSection<Props, Subject>[]
  readonly view: FrameView<Props, Subject>
  readonly subject: Subject
  readonly covered: boolean
  renderSection(section: FrameSection<Props, Subject>, base: FrameSectionProps): ReactNode
  returnFocusTo(): readonly string[]
  readonly marks: DataMarks
}

const callsForUser = (badge: SettingsBadge | null | undefined): badge is SettingsBadge =>
  badge !== null && badge !== undefined && (badge.tone === "warning" || badge.tone === "danger")

export function SettingsFrame<Props extends FrameSectionProps, Subject>(
  props: SettingsFrameProps<Props, Subject>,
) {
  const { t, controls, target, heading, sections, view, subject, covered } = props
  const section = view.kind === "section" ? view.section : null
  const guard = useObservable(controls.guard)
  const asking = useObservable(controls.asking)
  const compact = useCompactLayout()
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const titleId = `${id}-title`
  const panelId = `${id}-panel`
  const tabId = (item: FrameSection<Props, Subject>) => `${id}-tab-${item.id}`
  const listed = compact && (target.nav || section === null)

  const leaveOneLevel = () => {
    if (target.detail !== null) controls.back()
    else if (compact && !listed) controls.showNav()
    else controls.close()
  }

  const shownList = useRef(listed)
  useEffect(() => {
    if (shownList.current === listed) return
    shownList.current = listed
    if (dialogRef.current !== null) focusHome(dialogRef.current)
  }, [listed])

  const page = useMemo(
    () => ({ detail: target.detail, open: controls.openDetail, back: controls.back }),
    [target.detail, controls],
  )
  const close = useCallback(() => controls.dismiss(), [controls])

  return (
    <OverlayFrame
      surfaceRef={dialogRef}
      titleId={titleId}
      heading={
        compact && !listed && section !== null ? (
          <>
            <Button
              variant="icon"
              label={t("settings.back")}
              onClick={() => (target.detail === null ? controls.showNav() : controls.back())}
              marks={{ "data-dshb-settings-nav-back": "" }}
            >
              <IconChevronLeft />
            </Button>
            <OverlayTitle id={titleId} title={section.label(t)} />
          </>
        ) : (
          <>
            {heading.leading}
            <OverlayTitle id={titleId} title={heading.title} hint={heading.title} />
          </>
        )
      }
      closeLabel={t("settings.close")}
      closeMarks={{ "data-dshb-settings-close": "" }}
      onClose={() => controls.close()}
      dismissible
      onEscape={leaveOneLevel}
      yieldKeys={false}
      covered={covered}
      returnFocusTo={props.returnFocusTo}
      surfaceClass="dshb-settings"
      marks={props.marks}
      over={
        guard.leaving !== null ? (
          <DiscardConfirm
            t={t}
            leaving={guard.leaving}
            section={section?.label(t) ?? heading.title}
            onKeep={() => controls.keepEditing()}
            onDiscard={() => controls.discard()}
          />
        ) : (
          asking !== null && (
            <StepConfirm
              t={t}
              request={asking}
              onAnswer={(confirmed) => controls.answer(confirmed)}
            />
          )
        )
      }
    >
      {section === null ? (
        <div className="dshb-settings-page" data-dshb-settings-empty="">
          {view.kind === "empty" && view.message}
        </div>
      ) : (
        <>
          {listed ? (
            <CompactNav
              t={t}
              subject={subject}
              sections={sections}
              current={section.id}
              onSelect={(item) => controls.select(item.id)}
            />
          ) : (
            !compact && (
              <SectionNav
                t={t}
                subject={subject}
                sections={sections}
                current={section.id}
                tabId={tabId}
                panelId={panelId}
                onSelect={(item) => controls.select(item.id)}
              />
            )
          )}
          {!listed && (
            <section
              className="dshb-settings-page"
              role={compact ? undefined : "tabpanel"}
              id={panelId}
              aria-labelledby={compact ? titleId : tabId(section)}
              data-dshb-settings-section={section.id}
              data-dshb-settings-detail={target.detail ?? undefined}
            >
              <FramePageView
                key={section.id}
                detail={target.detail}
                back={compact ? null : { label: section.label(t), onBack: () => controls.back() }}
              >
                <PendingEditsContext.Provider value={controls.edits}>
                  {props.renderSection(section, { t, page, close, confirm: controls.confirm })}
                </PendingEditsContext.Provider>
              </FramePageView>
            </section>
          )}
        </>
      )}
    </OverlayFrame>
  )
}

interface PageViewProps {
  readonly detail: string | null
  readonly back: { readonly label: string; onBack(): void } | null
  readonly children: ReactNode
}

function FramePageView({ detail, back, children }: PageViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const shown = useRef(detail)
  useEffect(() => {
    if (shown.current === detail) return
    shown.current = detail
    const element = ref.current
    if (element === null) return
    element.closest(".dshb-settings-page")?.scrollTo({ top: 0 })
    const backRow = element.querySelector<HTMLElement>("[data-dshb-page-back]")
    if (backRow !== null) backRow.focus()
    else focusHome(element)
  }, [detail])
  return (
    <div className="dshb-settings-content" ref={ref}>
      {detail !== null && back !== null && <BackRow label={back.label} onBack={back.onBack} />}
      {children}
    </div>
  )
}

interface NavProps<Props extends FrameSectionProps, Subject> {
  readonly t: Translate
  readonly subject: Subject
  readonly sections: readonly FrameSection<Props, Subject>[]
  readonly current: string
  onSelect(section: FrameSection<Props, Subject>): void
}

function SectionNav<Props extends FrameSectionProps, Subject>(
  props: NavProps<Props, Subject> & {
    tabId(section: FrameSection<Props, Subject>): string
    readonly panelId: string
  },
) {
  const { t, subject, sections, current, tabId, panelId, onSelect } = props
  const selected = Math.max(
    sections.findIndex((item) => item.id === current),
    0,
  )
  const [focused, setFocused] = useState(selected)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setFocused(selected), [selected])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = barKey(event.key, focused, sections.length)
    if (next === undefined) return
    event.preventDefault()
    setFocused(next)
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <nav className="dshb-settings-nav" aria-label={t("settings.sections")}>
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label={t("settings.sections")}
        onKeyDown={onKeyDown}
      >
        {sections.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId(item)}
            className="dshb-settings-tab"
            aria-selected={item.id === current}
            aria-controls={item.id === current ? panelId : undefined}
            tabIndex={index === focused ? 0 : -1}
            data-dshb-settings-tab={item.id}
            data-dshb-autofocus={item.id === current ? "" : undefined}
            onFocus={() => setFocused(index)}
            onClick={() => onSelect(item)}
          >
            <NavEntry t={t} subject={subject} section={item} />
          </button>
        ))}
      </div>
    </nav>
  )
}

function CompactNav<Props extends FrameSectionProps, Subject>(props: NavProps<Props, Subject>) {
  const { t, subject, sections, current, onSelect } = props
  return (
    <nav className="dshb-settings-page dshb-settings-list" aria-label={t("settings.sections")}>
      <div className="dshb-ui-group-frame">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            className="dshb-ui-row dshb-settings-list-row"
            data-kind="open"
            data-dshb-settings-tab={item.id}
            data-dshb-autofocus={item.id === current ? "" : undefined}
            onClick={() => onSelect(item)}
          >
            <NavEntry t={t} subject={subject} section={item} />
            <span className="dshb-ui-row-chevron" aria-hidden="true">
              <IconChevronRight />
            </span>
          </button>
        ))}
      </div>
    </nav>
  )
}

function NavEntry<Props extends FrameSectionProps, Subject>(props: {
  readonly t: Translate
  readonly subject: Subject
  readonly section: FrameSection<Props, Subject>
}) {
  const { t, subject, section } = props
  const badge = useOptionalObservable(useMemo(() => section.badge?.(subject), [section, subject]))
  const Icon = section.icon
  return (
    <>
      <span className="dshb-settings-tab-icon">
        <Icon size={16} />
      </span>
      <span className="dshb-settings-tab-label">{section.label(t)}</span>
      {callsForUser(badge) && (
        <span
          className="dshb-settings-badge"
          data-tone={badge.tone}
          title={badge.label(t)}
          data-dshb-settings-badge={badge.tone}
        >
          <span className="dshb-sr">{badge.label(t)}</span>
        </span>
      )}
    </>
  )
}
