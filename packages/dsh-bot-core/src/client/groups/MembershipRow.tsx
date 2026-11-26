import { useObservable } from "../hooks"
import type { Observable } from "../observable"
import type { Translate } from "../types"
import { Button, Row } from "../ui"
import type { GroupsState } from "./model"
import { membershipOf } from "./view"

export interface MembershipRowProps {
  readonly t: Translate
  readonly botId: string
  readonly groups: Observable<GroupsState>
  openGroups(): void
}

export function membershipText(t: Translate, state: GroupsState, botId: string) {
  switch (state.status) {
    case "loading":
      return { meta: t("groups.loading"), tone: undefined }
    case "failed":
      return {
        meta: t("groups.unavailable", { message: state.failure.message }),
        tone: "danger" as const,
      }
    case "ready": {
      const membership = membershipOf(state.snapshot, botId)
      if (membership === undefined) return { meta: t("groups.membership.none"), tone: undefined }
      const role = membership.member.role === "" ? t("groups.role.none") : membership.member.role
      return { meta: `${membership.group.name} · ${role}`, tone: undefined }
    }
  }
}

export function MembershipRow({ t, botId, groups, openGroups }: MembershipRowProps) {
  const state = useObservable(groups)
  const { meta, tone } = membershipText(t, state, botId)
  return (
    <Row
      label={t("groups.membership")}
      meta={meta}
      metaTone={tone}
      marks={{ "data-dshb-general-group": "" }}
      trailing={
        <Button variant="row" onClick={openGroups} marks={{ "data-dshb-general-group-open": "" }}>
          {t("groups.membership.open")}
        </Button>
      }
    />
  )
}
