import { useEffect, useRef } from "react"
import type { SetupJobView } from "../../shared/vm-host-setup"
import type { Translate } from "../types"
import { Group, PageTitle, Row } from "../ui"

const FOLLOW_SLACK_PX = 24

export function SetupLogPage(props: { readonly t: Translate; readonly job: SetupJobView }) {
  const { t, job } = props
  const ref = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  const lines = job.log.tail
  useEffect(() => {
    const element = ref.current
    if (element !== null && following.current) element.scrollTop = element.scrollHeight
  }, [lines])
  return (
    <div className="dshb-settings-groups" data-dshb-setup-log-page="">
      <PageTitle>{t("setup.log")}</PageTitle>
      <Group>
        <Row
          label={t(`setup.title.${job.state}`)}
          meta={t("setup.log.shown", { shown: lines.length, total: job.log.lines })}
        />
        {lines.length === 0 ? (
          <Row label={t("setup.log.empty")} />
        ) : (
          <pre
            ref={ref}
            className="dshb-vm-host-log"
            data-size="page"
            onScroll={(event) => {
              const element = event.currentTarget
              following.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK_PX
            }}
          >
            {lines.map((line) => line.text).join("\n")}
          </pre>
        )}
      </Group>
    </div>
  )
}
