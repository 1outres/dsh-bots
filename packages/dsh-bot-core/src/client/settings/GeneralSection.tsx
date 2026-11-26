import { useMemo, useState } from "react"
import { type BotUpdateInput, MAX_NAME_LENGTH } from "../../shared/bots"
import { Avatar } from "../Avatar"
import { AvatarPicker } from "../AvatarPicker"
import { type AvatarChoice, avatarOfChoice, decomposeAvatar, sameChoice } from "../avatar-data"
import { timeZoneChoices } from "../time-zones"
import {
  ButtonRow,
  type Choice,
  Group,
  Row,
  SearchSelect,
  Select,
  TextField,
  useTextDraft,
} from "../ui"
import { type CommitResult, commitWith } from "../ui/commit"
import { failureText } from "./failure-text"
import type { SettingsSectionProps } from "./sections"

export interface LanguageOption {
  readonly id: string
  readonly label: string
}

export interface GeneralSectionDeps {
  saveBot(id: string, change: BotUpdateInput): Promise<void>
  deleteBot(id: string): void
  languages(): readonly LanguageOption[]
}

const UNSET = ""

export function GeneralSection({
  t,
  bot,
  saveBot,
  deleteBot,
  languages,
}: SettingsSectionProps & GeneralSectionDeps) {
  const save = (change: BotUpdateInput): Promise<CommitResult> =>
    commitWith(
      () => saveBot(bot.id, change),
      (cause) => failureText(t, cause),
    )
  const avatarSave = useSaveOutcome(save)
  const zoneSave = useSaveOutcome(save)
  const languageSave = useSaveOutcome(save)
  const saved = useMemo(() => decomposeAvatar(bot.avatar), [bot.avatar])

  const name = useTextDraft({
    value: bot.name,
    validate: (text) => (text.trim() === "" ? t("form.nameRequired") : null),
    commit: (text) => {
      const trimmed = text.trim()
      return save({ name: trimmed, avatar: avatarOfChoice(saved, trimmed) })
    },
  })
  const shownName = name.text.trim() === "" ? bot.name : name.text
  const pickAvatar = (choice: AvatarChoice) => {
    if (sameChoice(choice, saved)) return
    avatarSave.run({ avatar: avatarOfChoice(choice, bot.name) })
  }
  const zones = useMemo(() => timeZoneChoices(bot.timezone), [bot.timezone])
  const languageList = languageChoices(languages(), bot.language, t("form.languageUnset"))

  return (
    <div className="dshb-settings-groups" data-dshb-general="">
      <Group>
        <div className="dshb-ui-row dshb-general-identity" data-kind="block">
          <span className="dshb-general-preview">
            <Avatar avatar={avatarOfChoice(saved, shownName)} size={56} />
          </span>
          <div className="dshb-general-fields">
            <TextField
              draft={name}
              label={t("form.name")}
              placeholder={t("form.namePlaceholder")}
              maxLength={MAX_NAME_LENGTH}
              width="fill"
              marks={{ "data-dshb-general-name": "" }}
            />
            {(name.error ?? avatarSave.error) !== null && (
              <span className="dshb-ui-row-meta" data-tone="danger" role="alert">
                {name.error ?? avatarSave.error}
              </span>
            )}
            <AvatarPicker t={t} name={shownName} value={saved} onChange={pickAvatar} />
          </div>
        </div>
        <Row
          label={t("form.timezone")}
          meta={zoneSave.error ?? undefined}
          metaTone={zoneSave.error === null ? undefined : "danger"}
          trailing={
            <SearchSelect
              t={t}
              value={bot.timezone}
              choices={zones}
              onChange={(timezone) => zoneSave.run({ timezone })}
              label={t("form.timezone")}
              marks={{ "data-dshb-general-timezone": "" }}
            />
          }
        />
        <Row
          label={t("form.language")}
          meta={languageSave.error ?? undefined}
          metaTone={languageSave.error === null ? undefined : "danger"}
          trailing={
            <Select
              value={bot.language ?? UNSET}
              choices={languageList}
              onChange={(language) => languageSave.run({ language })}
              label={t("form.language")}
              marks={{ "data-dshb-general-language": "" }}
            />
          }
        />
      </Group>
      <Group>
        <ButtonRow
          label={t("settings.delete.open")}
          tone="danger"
          onClick={() => deleteBot(bot.id)}
          marks={{ "data-dshb-general-delete": "" }}
        />
      </Group>
    </div>
  )
}

function useSaveOutcome(save: (change: BotUpdateInput) => Promise<CommitResult>) {
  const [error, setError] = useState<string | null>(null)
  const run = (change: BotUpdateInput) =>
    void save(change).then((result) => setError(result.ok ? null : result.message))
  return { error, run }
}

export function languageChoices(
  offered: readonly LanguageOption[],
  current: string | undefined,
  unsetLabel: string,
): readonly Choice<string>[] {
  const known = offered.map((option) => ({ value: option.id, label: option.label }))
  if (current === undefined) return [{ value: UNSET, label: unsetLabel, disabled: true }, ...known]
  if (offered.some((option) => option.id === current)) return known
  return [...known, { value: current, label: current }]
}
