import { z } from "zod"
import type { MatrixServer } from "./server"

const versionSchema = z.object({ name: z.string(), version: z.string().min(1) })

const VACATED = {
  en: "Tuwunel cannot deactivate an application service's user, so the Matrix account of a deleted bot stays (it has left its rooms and its profile is cleared). An admin can deactivate it in the admin room with !admin users deactivate <user id>.",
  ja: "Tuwunel では Application Service のユーザーを無効化できないため、削除したボットの Matrix アカウントは残ります（部屋は出て、プロフィールは消してあります）。必要なら管理者ルームで !admin users deactivate <ユーザー ID> を実行してください。",
}

export const TUWUNEL: MatrixServer = {
  label: { en: "Tuwunel", ja: "Tuwunel" },
  registrationGuide: {
    en: "Save it in the directory appservice_dir names in tuwunel.toml and restart Tuwunel (or paste it to !admin appservices register in the admin room).",
    ja: "tuwunel.toml の appservice_dir のディレクトリに保存して Tuwunel を再起動します（または管理者ルームで !admin appservices register に貼り付けます）。",
  },
  retirementNote: VACATED,
  async identify(api, signal) {
    const parsed = versionSchema.safeParse(
      await api.unauthenticated("/_tuwunel/server_version", signal),
    )
    return parsed.success && parsed.data.name.toLowerCase() === "tuwunel"
      ? { version: parsed.data.version }
      : undefined
  },
  async retire() {
    return { kind: "vacated", note: VACATED }
  },
}
