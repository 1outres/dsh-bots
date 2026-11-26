import { z } from "zod"
import type { MatrixServer } from "./server"

const versionSchema = z.object({ server_version: z.string().min(1) })

export const SYNAPSE: MatrixServer = {
  label: { en: "Synapse", ja: "Synapse" },
  registrationGuide: {
    en: "Save it as a file the homeserver can read, list it under app_service_config_files in homeserver.yaml, and restart Synapse.",
    ja: "homeserver から読めるファイルとして保存し、homeserver.yaml の app_service_config_files に足して Synapse を再起動します。",
  },
  async identify(api, signal) {
    const parsed = versionSchema.safeParse(
      await api.unauthenticated("/_synapse/admin/v1/server_version", signal),
    )
    return parsed.success ? { version: parsed.data.server_version } : undefined
  },
  async retire(api, signal) {
    await api.deactivate(signal)
    return { kind: "deactivated" }
  },
}
