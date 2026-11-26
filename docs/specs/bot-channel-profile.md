# チャネルへの名前とアバターの反映

2026-11-26 に決めたこと。ボットの名前やアバターを dsh-bots で変えたとき（Web UI でも、ボット自身が `bot_settings` で変えたときでも）、設定したチャネル（今は Discord だけ）の名前とアイコンも変える。bot-core のチャネル contract と `packages/dsh-bot-discord` を変える。

## 1. 考え方

- 反映するかどうかは **ボットごと・チャネルごと** のスイッチで決める。初期値はオフ（既存の設定も、新しく作る設定も）。
- スイッチはチャネル固有の項目ではなく bot-core のもの。チャネルは contract で「名前・アバターを受け取れる」と宣言するだけで、設定画面の行もボットの設定（`bot_settings`）の項目も bot-core が出す。
- 名前やアバターが変わっても接続はやり直さない。bot-core が `profile` 出力を送り、チャネルが適用する。
- アバターの画像は bot-core が Host で作る（チャネルごとに描き方が変わらないように）。

## 2. contract

| 追加                                   | 中身                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BotChannelCapabilities.profile`       | `{ name: boolean, avatar: boolean }`（どちらかは `true`）。受け取れるものだけ送る。                                                                                    |
| 出力 `{ kind: "profile", profile }`    | `BotChannelProfile`: `digest`（送る中身全体のダイジェスト）、`name?`、`avatar?`（`{ mediaType: "image/png", size: 512, data, digest }`、`digest` は PNG の SHA-256）。 |
| `BotChannelLink.reportProfile(report)` | `{ digest, state: "synced" }` か `{ digest, state: "failed", problems }`（`problems` は `{ en, ja? }` の列）。最新の `profile` の `digest` 以外の報告は捨てる。        |
| `BotChannelChange.profileSync`（必須） | スイッチの値。`profile` を宣言しないチャネルで `true` は拒否する。                                                                                                     |
| `BotChannelView.profile?`              | `profile` を宣言したチャネルだけ: `{ supports, sync, status? }`。`status` は `syncing` / `synced` / `failed`（問題の列つき）。                                         |

## 3. bot-core の動き

- **保存**: `dsh_bot_channels` の `channels` レコードに `profileSync`（任意の boolean）を足す。無いレコードはオフ。追加は互換なので domain のバージョンは上げない（スナップショットだけ更新）。
- **接続を作り直さない**: `configure` で変わったのが `profileSync` だけのときは `revision` を上げない（hub は `revision` で作り直すので接続は残る）。それ以外は今までどおり上げる。
- **送るとき**（`host/channels/profile/sync.ts`）:
  - 接続ができたとき（hub が `outlets.attach` の後に知らせる）。
  - スイッチがオンになったとき（設定の変更通知）。
  - ボットの名前かアバターが変わったとき（registry の変更通知）。
  - チャネルが受け取るもの（名前・アバター）から作ったキーが前回送ったものと同じなら送らない。スイッチをオフにすると忘れるので、次にオンにしたときにまた送る。
  - 描画は非同期。描いている間に新しい変更が来たら古いほうは送らない。
- **状態**: 送ったら `syncing`、チャネルの報告で `synced` / `failed`。描画に失敗したら `failed`（理由つき）にしてログにも出す。接続が閉じたら消える。
- **描画**（`host/channels/profile/render.ts`、`avatar-svg.ts`、`sharp.ts`）:
  - キャラクター: `shared/character-shapes.ts`（Web UI の `CharacterAvatar` と同じデータ。client から shared に移した）から SVG を作る。Web UI と違い円で切り抜かず、正方形を色で塗る（チャネル側が丸く切る）。
  - 文字（initial）: 同じ正方形に白い文字（`sans-serif`、600、ビューの半分の大きさ）。
  - 画像: data URL をそのまま読み、中央で正方形に切って縮小する（GIF は 1 枚目）。
  - いずれも 512 × 512 の PNG にする。Discord が受け付けるのは PNG / JPEG / GIF（Image Data）なので PNG にそろえる。
  - 同じアバターの画像は覚えておき（32 個まで）、チャネルごとに描き直さない。
- **ボットの設定**: `channels.<id>` エリアに `profileSync`（toggle、変更は `approve`）を足す。`profile` を宣言したチャネルだけ。
- **Web UI**: チャネルのグループのフィールドの下に「名前とアバターを反映」の行（受け取るものに応じて「名前を反映」「アバターを反映」）とスイッチ。オンのときは状態（更新中… / 反映済み / 反映できませんでした — 理由）を出す。ウェルカムガイドの下書きではオフのまま（行も出さない）。

## 4. ラスタライザとフォント

- **sharp**（0.35、libvips）を bot-core の依存にする。インストールスクリプトは無く、プラットフォームごとのビルド済みパッケージ（`@img/sharp-*`）が optionalDependencies で入るので、`pnpm-workspace.yaml` の `allowBuilds` / `onlyBuiltDependencies` に足すものは無い。最初に描くときに読み込む（読み込めなければその理由で `failed`）。
- **@resvg/resvg-js** も試したが、WebP を読めない（2.6.2 と 2.7.0-alpha.2 で確認）。Web UI は画像アバターを WebP で保存することがあるので、resvg-js だけでは画像アバターを PNG にできない。WebP 用のデコーダを別に足すより、SVG・PNG・JPEG・WebP・GIF をまとめて扱える sharp を選んだ（大きさは約 20 MB）。
- **フォント**: 文字のアバターは Host のフォントで描く（sharp の librsvg / Pango が fontconfig 経由でシステムのフォントを使い、足りない文字はほかのフォントから探す）。フォントは同梱しない。CJK や絵文字のフォント（たとえば Noto Sans CJK と Noto Color Emoji）が Host に無いと、その文字は豆腐（欠けた文字の印）になる。Web UI はブラウザのフォントで描くので、見た目が少し違うことがある。

## 5. Discord の動き

- `DISCORD_CAPABILITIES.profile = { name: true, avatar: true }`。
- 名前はボット自身の Discord ユーザーのユーザー名（グローバル。DM でもサーバーでも同じ）。サーバーのニックネームは触らない。
- `profile` を受け取ったら最新のものを覚え、Gateway が `ready` になってから適用する（`src/host/profile/presenter.ts`）。返信やカードの出力を待たせない（受け取りはすぐ終わり、適用は別の列で行う）。
- 適用の順番: アバター → ユーザー名（別々のリクエスト。ユーザー名が断られてもアバターは変わる）。
- **同じものは送らない**: `dsh_bot_discord` に `profiles` テーブルを足す（キーはボット、Discord のユーザー id、最後に適用したユーザー名とアバターのダイジェスト）。domain はバージョン 4（1〜3 を読む）。トークンを変えて別の Discord ユーザーになったら全部送り直す。ユーザー名は Gateway が知らせる今の名前と同じときも送らない。書くのは `src/host/profile/records.ts` だけ（design rule 72 に足した）。
- **名前の検査**（`src/host/profile/username.ts`）: 前後と連続する空白をまとめたうえで 2〜32 文字、`@`、`#`、`:`、3 つ続きのバッククォート、`discord` を含まない、`everyone` / `here` でない。通らない名前は送らず、理由を報告する。
- **失敗**: Discord の断り（`USERNAME_RATE_LIMIT` などの `…RATE_LIMIT`、429 は `rate-limited`、ほかは `rejected`、`src/host/discordjs/failures.ts`）や届かなかったことは `reportProfile` の `failed` で Web UI に出し、ログにも残す。接続は切らない。自動ではやり直さない（Discord はユーザー名の変更を 1 時間に数回までにしていて、決まった待ち時間も教えない）。次に名前やアバターを変えたとき、または次に接続したときに試す。

## 6. 入れないもの

- 自動のやり直し、名前を Discord に合わせて縮めたり書き換えたりすること。
- サーバーごとのニックネームやアバター。
- フォントの同梱。
- ウェルカムガイドでのスイッチ。
