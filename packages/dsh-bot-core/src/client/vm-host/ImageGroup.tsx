import type { BotEnvironmentImageView } from "../../shared/environment-image"
import type { Translate } from "../types"
import { BlockRow, Button, Code, Group, type PillTone, Row, StatusPill } from "../ui"
import { Command } from "./Command"
import type { VmHostClient } from "./client"
import { imageImportable, progressOf } from "./model"

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

function imagePill(
  t: Translate,
  image: BotEnvironmentImageView,
): { tone: PillTone; label: string } {
  switch (image.status.kind) {
    case "unchecked":
      return { tone: "idle", label: t("image.unchecked") }
    case "checking":
      return { tone: "busy", label: t("image.checking") }
    case "ready":
      return { tone: "success", label: t("image.ready") }
    case "missing":
      return { tone: "warning", label: t("image.missing") }
    case "importing":
      return { tone: "busy", label: t(`image.step.${image.status.progress.step}`) }
    case "failed":
      return { tone: "danger", label: t("image.failed") }
  }
}

export function ImageGroup(props: {
  readonly t: Translate
  readonly image: BotEnvironmentImageView
  readonly host: VmHostClient
  onFailure(message: string): void
}) {
  const { t, image, host } = props
  const pill = imagePill(t, image)
  const run = (work: () => Promise<unknown>) =>
    void work().catch((cause: unknown) => props.onFailure(messageOf(cause)))
  const status = image.status
  return (
    <Group
      title={t("image.title")}
      aside={
        <Button
          variant="row"
          disabled={status.kind === "checking" || status.kind === "importing"}
          onClick={() => run(() => host.refreshImage())}
          marks={{ "data-dshb-vm-host-image-refresh": "" }}
        >
          {t("image.refresh")}
        </Button>
      }
      marks={{ "data-dshb-vm-host-image": status.kind }}
    >
      <Row
        label={t("image.alias")}
        meta={image.project === undefined ? image.alias : `${image.alias} · ${image.project}`}
        trailing={
          <>
            <StatusPill tone={pill.tone} label={pill.label} />
            {imageImportable(image) && (
              <Button
                variant="row"
                onClick={() => run(() => host.startImage())}
                marks={{ "data-dshb-vm-host-image-import": "" }}
              >
                {t("image.import")}
              </Button>
            )}
            {status.kind === "importing" && (
              <Button
                variant="row"
                onClick={() => run(() => host.cancelImage())}
                marks={{ "data-dshb-vm-host-image-cancel": "" }}
              >
                {t("image.cancel")}
              </Button>
            )}
          </>
        }
      />
      <Row
        label={t("image.release")}
        meta={image.managed ? image.release?.tag : t("image.manual")}
        trailing={
          image.image === undefined ? undefined : (
            <Code>{image.image.fingerprint.slice(0, 12)}</Code>
          )
        }
      />
      {status.kind === "importing" && status.progress.totalBytes > 0 && (
        <Row
          label={t(`image.step.${status.progress.step}`)}
          meta={t(
            "image.progress",
            progressOf(status.progress.doneBytes, status.progress.totalBytes),
          )}
          marks={{ "data-dshb-vm-host-image-progress": status.progress.step }}
        />
      )}
      {status.kind === "failed" && (
        <BlockRow
          label={status.problem.message}
          metaTone="danger"
          marks={{ "data-dshb-vm-host-image-problem": status.problem.code }}
        >
          <Command t={t} text={status.problem.fix} />
        </BlockRow>
      )}
    </Group>
  )
}
