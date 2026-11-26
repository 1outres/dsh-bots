import { type ReactNode, useState } from "react"
import type { BotView } from "../../shared/bots"
import {
  type BotGroupsSnapshot,
  type BotGroupView,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_PURPOSE_LENGTH,
  MAX_MEMBER_ROLE_LENGTH,
} from "../../shared/peers"
import { Avatar } from "../Avatar"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { useObservable } from "../hooks"
import { IconCheck } from "../icons"
import { localeFormat } from "../locale-format"
import type { Observable } from "../observable"
import { type BotsState, snapshotOf } from "../session-classification"
import { failureText } from "../settings/failure-text"
import type { Translate } from "../types"
import {
  BlockRow,
  Button,
  ButtonRow,
  commitWith,
  ErrorText,
  Group,
  NavRow,
  Row,
  RowMenu,
  Select,
  StatusPill,
  Switch,
  TextArea,
  TextField,
  TextFieldRow,
  TextInput,
  useTextDraft,
} from "../ui"
import { GroupMessagesPage } from "./GroupMessagesPage"
import type { GroupsFeed } from "./model"
import {
  type GroupMemberEntry,
  groupOfDetail,
  joinChoices,
  memberEntries,
  membershipOf,
  messagesDetail,
  pauseDetail,
  pausePill,
  selectableBots,
} from "./view"

export interface GroupsSectionDeps {
  readonly groups: GroupsFeed
  readonly bots: Observable<BotsState>
}

type GroupProps = GlobalSettingsSectionProps & {
  readonly groups: GroupsFeed
  readonly snapshot: BotGroupsSnapshot
  readonly known: readonly BotView[]
}

const NO_BOTS: readonly BotView[] = []

export function GroupsSection(props: GlobalSettingsSectionProps & GroupsSectionDeps) {
  const { t, groups, page } = props
  const state = useObservable(groups)
  const bots = useObservable(props.bots)
  const known = snapshotOf(bots)
  if (state.status === "loading") {
    return (
      <Group>
        <Row label={t("groups.loading")} />
      </Group>
    )
  }
  if (state.status === "failed") {
    return <ErrorText>{t("groups.unavailable", { message: state.failure.message })}</ErrorText>
  }
  const { snapshot } = state
  const all = known?.bots ?? NO_BOTS
  const shownGroupId = groupOfDetail(page.detail)
  const shown = snapshot.groups.find((group) => group.id === shownGroupId)
  if (shown !== undefined) {
    return <GroupMessagesPage t={t} group={shown} bots={all} groups={groups} />
  }
  const selectable = known === undefined ? NO_BOTS : selectableBots(known)
  return (
    <div className="dshb-settings-groups" data-dshb-groups="">
      {snapshot.groups.map((group) => (
        <GroupCard
          key={group.id}
          t={t}
          page={page}
          close={props.close}
          confirm={props.confirm}
          groups={groups}
          snapshot={snapshot}
          known={all}
          selectable={selectable}
          group={group}
        />
      ))}
      <NewGroup t={t} groups={groups} />
    </div>
  )
}

function GroupCard(
  props: GroupProps & { readonly group: BotGroupView; readonly selectable: readonly BotView[] },
) {
  const { t, group, groups, known } = props
  const save = (change: { readonly name?: string; readonly purpose?: string }) =>
    commitWith(
      () => groups.update(group.id, change),
      (cause) => failureText(t, cause),
    )
  const purpose = useTextDraft({
    value: group.purpose,
    validate: (text) =>
      [...text.trim()].length > MAX_GROUP_PURPOSE_LENGTH
        ? t("groups.purpose.tooLong", { max: MAX_GROUP_PURPOSE_LENGTH })
        : null,
    commit: (text) => save({ purpose: text }),
  })
  return (
    <Group title={group.name} marks={{ "data-dshb-group": group.id }}>
      <TextFieldRow
        label={t("groups.name")}
        value={group.name}
        maxLength={MAX_GROUP_NAME_LENGTH}
        validate={(text) => (text.trim() === "" ? t("groups.name.required") : null)}
        commit={(text) => save({ name: text })}
        marks={{ "data-dshb-group-name": group.id }}
      />
      <BlockRow
        label={t("groups.purpose")}
        meta={purpose.error ?? undefined}
        metaTone={purpose.error === null ? undefined : "danger"}
      >
        <TextArea
          draft={purpose}
          label={t("groups.purpose")}
          rows={3}
          marks={{ "data-dshb-group-purpose": group.id }}
        />
      </BlockRow>
      {memberEntries(group, known).map((entry) => (
        <MemberRow key={entry.member.botId} t={t} groups={groups} entry={entry} />
      ))}
      <AddMember {...props} />
      <PauseRow t={t} groups={groups} group={group} />
      <MessagesRow {...props} />
      <DeleteGroup {...props} />
    </Group>
  )
}

function MemberRow(props: {
  readonly t: Translate
  readonly groups: GroupsFeed
  readonly entry: GroupMemberEntry
}) {
  const { t, groups, entry } = props
  const { member, bot } = entry
  const [editing, setEditing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const name = bot?.name ?? member.botId
  const leading = bot === undefined ? undefined : <Avatar avatar={bot.avatar} size={24} />
  if (editing) {
    return (
      <RoleEditor
        t={t}
        name={name}
        leading={leading}
        role={member.role}
        commit={(role) =>
          commitWith(
            () => groups.setRole(member.botId, role),
            (cause) => failureText(t, cause),
          )
        }
        done={() => setEditing(false)}
        botId={member.botId}
      />
    )
  }
  const leave = async () => {
    try {
      await groups.leave(member.botId)
    } catch (cause) {
      setFailure(failureText(t, cause))
    }
  }
  return (
    <Row
      leading={leading}
      label={name}
      meta={failure ?? (member.role === "" ? t("groups.role.none") : member.role)}
      metaTone={failure === null ? undefined : "danger"}
      marks={{ "data-dshb-group-member": member.botId }}
      trailing={
        <RowMenu
          label={t("groups.member.menu", { bot: name })}
          items={[
            {
              id: "role",
              label: t("groups.member.role"),
              run: () => {
                setFailure(null)
                setEditing(true)
              },
            },
            {
              id: "leave",
              label: t("groups.member.leave"),
              tone: "danger",
              run: () => void leave(),
            },
          ]}
        />
      }
    />
  )
}

function RoleEditor(props: {
  readonly t: Translate
  readonly name: string
  readonly leading: ReactNode
  readonly role: string
  readonly botId: string
  commit(role: string): ReturnType<typeof commitWith>
  done(): void
}) {
  const { t } = props
  const draft = useTextDraft({
    value: props.role,
    validate: (text) =>
      [...text.trim()].length > MAX_MEMBER_ROLE_LENGTH
        ? t("groups.role.tooLong", { max: MAX_MEMBER_ROLE_LENGTH })
        : null,
    commit: async (text) => {
      const result = await props.commit(text.trim())
      if (result.ok) props.done()
      return result
    },
  })
  return (
    <Row
      leading={props.leading}
      label={props.name}
      meta={draft.error ?? undefined}
      metaTone={draft.error === null ? undefined : "danger"}
      marks={{ "data-dshb-group-member": props.botId }}
      trailing={
        <TextField
          draft={draft}
          label={t("groups.role")}
          placeholder={t("groups.role.placeholder")}
          maxLength={MAX_MEMBER_ROLE_LENGTH}
          autoFocus
          onBlur={() => {
            if (!draft.editing && !draft.busy) props.done()
          }}
          marks={{ "data-dshb-group-role": props.botId }}
        />
      }
    />
  )
}

const UNPICKED = ""

function AddMember(
  props: GroupProps & { readonly group: BotGroupView; readonly selectable: readonly BotView[] },
) {
  const { t, group, groups, snapshot, selectable, confirm } = props
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const choices = joinChoices(t, snapshot, selectable, group.id)
  const pick = async (botId: string) => {
    const bot = selectable.find((each) => each.id === botId)
    if (bot === undefined) return
    const current = membershipOf(snapshot, botId)
    if (current !== undefined) {
      const accepted = await confirm({
        title: t("groups.move.title", { bot: bot.name }),
        description: t("groups.move.description", {
          bot: bot.name,
          from: current.group.name,
          group: group.name,
        }),
        confirm: t("groups.move.accept"),
        tone: "primary",
      })
      if (!accepted) return
    }
    setBusy(true)
    setFailure(null)
    try {
      await groups.join(
        group.id,
        botId,
        current === undefined ? { role: "" } : { role: "", from: current.group.id },
      )
    } catch (cause) {
      setFailure(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Row
      label={t("groups.add")}
      meta={failure ?? undefined}
      metaTone={failure === null ? undefined : "danger"}
      trailing={
        <Select
          value={UNPICKED}
          choices={[
            {
              value: UNPICKED,
              label: choices.length === 0 ? t("groups.add.none") : t("groups.add.choose"),
              disabled: true,
            },
            ...choices,
          ]}
          onChange={(botId) => void pick(botId)}
          label={t("groups.add")}
          disabled={busy || choices.length === 0}
          marks={{ "data-dshb-group-add": group.id }}
        />
      }
    />
  )
}

function PauseRow(props: {
  readonly t: Translate
  readonly groups: GroupsFeed
  readonly group: BotGroupView
}) {
  const { t, groups, group } = props
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { paused } = group
  const format = localeFormat(t)
  const set = async (on: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      await groups.setPaused(group.id, !on)
    } catch (cause) {
      setFailure(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  const pill = paused === undefined ? undefined : pausePill(t, paused)
  return (
    <Row
      label={t("groups.pause")}
      meta={
        failure ??
        (paused === undefined
          ? undefined
          : pauseDetail(t, paused, (at) => format.instant(at, "dateTime")))
      }
      metaTone={failure === null ? undefined : "danger"}
      marks={{ "data-dshb-group-pause": group.id }}
      trailing={
        <>
          {pill !== undefined && <StatusPill tone={pill.tone} label={pill.label} />}
          <Switch
            checked={paused === undefined}
            onChange={(on) => void set(on)}
            label={t("groups.pause")}
            disabled={busy}
          />
        </>
      }
    />
  )
}

function MessagesRow(props: GroupProps & { readonly group: BotGroupView }) {
  const { t, group, page } = props
  const format = localeFormat(t)
  const { messages, lastSentAt } = group.activity
  const meta =
    messages === 0 || lastSentAt === undefined
      ? t("groups.messages.none")
      : `${format.count("groups.messages.count", messages)} · ${format.instant(lastSentAt, "dateTime")}`
  return (
    <NavRow
      label={t("groups.messages")}
      meta={meta}
      onOpen={() => page.open(messagesDetail(group.id))}
      marks={{ "data-dshb-group-messages": group.id }}
    />
  )
}

function DeleteGroup(props: GroupProps & { readonly group: BotGroupView }) {
  const { t, group, groups, confirm } = props
  const [failure, setFailure] = useState<string | null>(null)
  const remove = async () => {
    const accepted = await confirm({
      title: t("groups.delete.title", { group: group.name }),
      description: t("groups.delete.description"),
      confirm: t("groups.delete.accept"),
      tone: "danger",
    })
    if (!accepted) return
    try {
      await groups.deleteGroup(group.id)
    } catch (cause) {
      setFailure(failureText(t, cause))
    }
  }
  return (
    <>
      <ButtonRow
        label={t("groups.delete")}
        tone="danger"
        onClick={() => void remove()}
        marks={{ "data-dshb-group-delete": group.id }}
      />
      {failure !== null && <Row label="" meta={failure} metaTone="danger" />}
    </>
  )
}

function NewGroup(props: { readonly t: Translate; readonly groups: GroupsFeed }) {
  const { t, groups } = props
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const create = async () => {
    if (busy) return
    if (name.trim() === "") {
      setFailure(t("groups.name.required"))
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await groups.create({ name, purpose: "" })
      setName("")
    } catch (cause) {
      setFailure(failureText(t, cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group>
      <Row
        label={t("groups.new")}
        meta={failure ?? undefined}
        metaTone={failure === null ? undefined : "danger"}
        marks={{ "data-dshb-group-new": "" }}
        trailing={
          <form
            className="dshb-groups-new"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <TextInput
              value={name}
              onChange={(text) => {
                setName(text)
                setFailure(null)
              }}
              label={t("groups.new.name")}
              placeholder={t("groups.new.name")}
              maxLength={MAX_GROUP_NAME_LENGTH}
              disabled={busy}
              width="fill"
              marks={{ "data-dshb-group-new-name": "" }}
            />
            <Button
              variant="icon"
              type="submit"
              label={t("groups.new.create")}
              disabled={busy || name.trim() === ""}
              marks={{ "data-dshb-group-create": "" }}
            >
              <IconCheck size={16} />
            </Button>
          </form>
        }
      />
    </Group>
  )
}
