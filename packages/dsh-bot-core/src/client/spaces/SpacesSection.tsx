import { type FormEvent, useId, useState } from "react"
import type { BotSpaceLinkCreated, BotSpaceView, SpaceVisibility } from "../../shared/spaces"
import { SPACE_LIMITS } from "../../shared/spaces"
import { useObservable } from "../hooks"
import { IconLink, IconSpace } from "../icons"
import { localeFormat } from "../locale-format"
import type { SettingsSectionProps } from "../settings/sections"
import type { Translate } from "../types"
import { Button } from "../ui/Button"
import { CopyButton } from "../ui/CopyButton"
import { EmptyState, ErrorText } from "../ui/EmptyState"
import { Group } from "../ui/Group"
import { usePendingEdit } from "../ui/pending-edits"
import { BlockRow, ButtonRow, Row } from "../ui/Row"
import { Segmented } from "../ui/Segmented"
import { Select } from "../ui/Select"
import { StatusPill } from "../ui/StatusPill"
import { Switch } from "../ui/Switch"
import { Code } from "../ui/Tag"
import { TextInput } from "../ui/TextInput"
import type { SpacesFace } from "./face"
import { spaceErrorText } from "./failure-text"
import { spacesViewOf } from "./feed"
import type { SpaceConfirm } from "./flows"
import { sizeText } from "./format"
import { LINK_DAYS_CHOICES, spacesOfBot } from "./model"
import { parseSpaceDetail } from "./pages"

export interface SpacesSectionDeps {
  readonly spaces: SpacesFace
}

type SectionProps = SettingsSectionProps & SpacesSectionDeps

export function SpacesSection(props: SectionProps) {
  const { t, bot, page, spaces } = props
  const state = useObservable(spaces.feed)
  const view = spacesViewOf(state)
  if (state.status === "loading") return <p className="dshb-note">{t("spaces.loading")}</p>
  if (view === undefined) {
    return (
      <ErrorText>
        {t("spaces.unavailable", { message: "message" in state ? state.message : "" })}
      </ErrorText>
    )
  }
  const list = spacesOfBot(view.spaces, bot.id)
  const detail = parseSpaceDetail(page.detail)
  if (detail !== undefined) {
    const space = list.find((item) => item.id === detail.spaceId)
    return (
      <div className="dshb-spaces-settings" data-dshb-spaces-settings="detail">
        {space === undefined ? (
          <ErrorText>{t("spaces.error.notFound")}</ErrorText>
        ) : (
          <SpaceGroup {...props} space={space} linkOpen={detail.intent === "link"} />
        )}
      </div>
    )
  }
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<IconSpace size={24} />}
        title={t("spaces.none")}
        marks={{ "data-dshb-spaces-none": "" }}
      />
    )
  }
  return (
    <div className="dshb-spaces-settings" data-dshb-spaces-settings="list">
      {list.map((space) => (
        <SpaceGroup key={space.id} {...props} space={space} linkOpen={false} />
      ))}
    </div>
  )
}

function SpaceGroup(
  props: SectionProps & { readonly space: BotSpaceView; readonly linkOpen: boolean },
) {
  const { t, space, spaces, confirm } = props
  const error = useObservable(spaces.errors)[space.id]
  const format = localeFormat(t)
  const run = (action: () => Promise<unknown>) => spaces.run(space, action)
  const visibilityChoices = [
    { value: "owner" as const, label: t("spaces.visibility.owner") },
    { value: "public" as const, label: t("spaces.visibility.public") },
  ]
  const settingsConfirm: SpaceConfirm = confirm
  return (
    <>
      <Group title={space.title} marks={{ "data-dshb-space-group": space.id }}>
        <Row
          label={t("spaces.revision.label")}
          meta={
            space.revision === null
              ? t("spaces.unpublished")
              : t("spaces.revision.meta", {
                  number: space.revision.number,
                  time: format.instant(space.revision.publishedAt, "dateTime"),
                  size: sizeText(t, space.revision.bytes),
                })
          }
          marks={{ "data-dshb-space-revision-row": "" }}
        />
        <Row
          label={t("spaces.visibility")}
          trailing={
            <Segmented<SpaceVisibility>
              value={space.visibility}
              choices={visibilityChoices}
              label={t("spaces.visibility")}
              onChange={(visibility) =>
                run(() => spaces.flows.setVisibility(space, visibility, settingsConfirm))
              }
              marks={{ "data-dshb-space-visibility-choice": "" }}
            />
          }
        />
        {space.visibility === "public" && <PublicUrlRow t={t} space={space} />}
        <Row
          label={t("spaces.visitorWrites")}
          trailing={
            <Switch
              checked={space.visitorWrites}
              label={t("spaces.visitorWrites")}
              onChange={(allowed) =>
                run(() => spaces.flows.setVisitorWrites(space, allowed, settingsConfirm))
              }
              marks={{ "data-dshb-space-visitor-writes": "" }}
            />
          }
        />
        <Row
          label={t("spaces.pinned")}
          trailing={
            <Switch
              checked={space.pinned}
              label={t("spaces.pinned")}
              onChange={(pinned) => run(() => spaces.flows.setPinned(space, pinned))}
              marks={{ "data-dshb-space-pinned": "" }}
            />
          }
        />
        <SpaceLinks t={t} space={space} spaces={spaces} startOpen={props.linkOpen} />
        <Row
          label={t("spaces.kv")}
          meta={t("spaces.kv.meta", {
            keys: format.count("spaces.kv.keys", space.kv.keys),
            size: sizeText(t, space.kv.bytes),
          })}
        />
        <ButtonRow
          label={t("spaces.delete")}
          tone="danger"
          onClick={() => run(() => spaces.flows.discard(space, settingsConfirm))}
          marks={{ "data-dshb-space-delete": "" }}
        />
      </Group>
      {error !== undefined && <ErrorText>{error}</ErrorText>}
    </>
  )
}

function PublicUrlRow({ t, space }: { readonly t: Translate; readonly space: BotSpaceView }) {
  return (
    <Row
      label={t("spaces.publicUrl")}
      meta={space.publicUrl === null ? undefined : <Code>{space.publicUrl}</Code>}
      trailing={
        space.publicUrl === null ? (
          <StatusPill tone="warning" label={t("spaces.baseUrl.off")} />
        ) : (
          <CopyButton
            text={space.publicUrl}
            label={t("spaces.link.copy")}
            copiedLabel={t("spaces.link.copied")}
          />
        )
      }
      marks={{ "data-dshb-space-public-url": space.publicUrl === null ? "off" : "on" }}
    />
  )
}

function SpaceLinks(props: {
  readonly t: Translate
  readonly space: BotSpaceView
  readonly spaces: SpacesFace
  readonly startOpen: boolean
}) {
  const { t, space, spaces } = props
  const [open, setOpen] = useState(props.startOpen)
  const [created, setCreated] = useState<BotSpaceLinkCreated | null>(null)
  const format = localeFormat(t)
  return (
    <>
      <Row
        label={t("spaces.links")}
        meta={space.links.length === 0 ? t("spaces.links.none") : undefined}
        trailing={
          !open && (
            <Button
              variant="row"
              onClick={() => setOpen(true)}
              marks={{ "data-dshb-space-link-open": "" }}
            >
              {t("spaces.link.create")}
            </Button>
          )
        }
      />
      {space.links.map((link) => (
        <Row
          key={link.id}
          density="compact"
          leading={<IconLink size={14} />}
          label={link.label}
          meta={t("spaces.link.meta", {
            issuer: t(
              link.issuedBy === "bot" ? "spaces.link.issuer.bot" : "spaces.link.issuer.owner",
            ),
            time: format.instant(link.expiresAt, "dateTime"),
          })}
          description={link.reason ?? undefined}
          trailing={
            <Button
              variant="row"
              tone="danger"
              onClick={() => spaces.run(space, () => spaces.flows.revokeLink(space, link.id))}
              marks={{ "data-dshb-space-link-revoke": link.id }}
            >
              {t("spaces.link.revoke")}
            </Button>
          }
          marks={{ "data-dshb-space-link": link.id }}
        />
      ))}
      {open && (
        <LinkForm
          t={t}
          space={space}
          spaces={spaces}
          onDone={(link) => {
            setOpen(false)
            setCreated(link)
          }}
          onCancel={() => setOpen(false)}
        />
      )}
      {created !== null && <CreatedLinkRow t={t} link={created} />}
    </>
  )
}

function LinkForm(props: {
  readonly t: Translate
  readonly space: BotSpaceView
  readonly spaces: SpacesFace
  onDone(link: BotSpaceLinkCreated): void
  onCancel(): void
}) {
  const { t, space, spaces } = props
  const id = useId()
  const [label, setLabel] = useState("")
  const [days, setDays] = useState<string>(String(SPACE_LIMITS.linkDaysDefault))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  usePendingEdit(label !== "")
  const format = localeFormat(t)
  const choices = LINK_DAYS_CHOICES.map((count) => ({
    value: String(count),
    label: format.count("spaces.link.days", count),
  }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (label.trim() === "") {
      setError(t("spaces.link.label.empty"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      props.onDone(
        await spaces.flows.createLink(space, { label: label.trim(), days: Number(days) }),
      )
    } catch (cause) {
      setError(spaceErrorText(t, cause))
      setBusy(false)
    }
  }
  return (
    <BlockRow
      label={t("spaces.link.create")}
      meta={error ?? undefined}
      metaTone={error === null ? undefined : "danger"}
      marks={{ "data-dshb-space-link-form": "" }}
    >
      <form id={id} className="dshb-space-link-form" onSubmit={(event) => void submit(event)}>
        <TextInput
          value={label}
          onChange={setLabel}
          label={t("spaces.link.label")}
          placeholder={t("spaces.link.label")}
          maxLength={SPACE_LIMITS.labelLength}
          disabled={busy}
          autoFocus
          marks={{ "data-dshb-space-link-label": "" }}
        />
        <Select
          value={days}
          choices={choices}
          onChange={setDays}
          label={t("spaces.link.days")}
          disabled={busy}
          marks={{ "data-dshb-space-link-days": "" }}
        />
        <Button variant="row" onClick={props.onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button
          variant="row"
          type="submit"
          disabled={busy}
          marks={{ "data-dshb-space-link-submit": "" }}
        >
          {t("spaces.link.submit")}
        </Button>
      </form>
    </BlockRow>
  )
}

function CreatedLinkRow(props: { readonly t: Translate; readonly link: BotSpaceLinkCreated }) {
  const { t, link } = props
  return (
    <Row
      label={t("spaces.link.created")}
      meta={link.url === null ? undefined : <Code>{link.url}</Code>}
      trailing={
        link.url === null ? (
          <StatusPill tone="warning" label={t("spaces.baseUrl.off")} />
        ) : (
          <CopyButton
            text={link.url}
            label={t("spaces.link.copy")}
            copiedLabel={t("spaces.link.copied")}
          />
        )
      }
      marks={{ "data-dshb-space-link-created": link.url === null ? "off" : link.id }}
    />
  )
}
