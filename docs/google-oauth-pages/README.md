# Google の OAuth 同意画面のブランディング用ページ

個人用の Google アカウントでコネクターを使うには、OAuth 同意画面を「本番環境」に公開する必要があり、公開には **ブランディング** にホームページとプライバシーポリシーの URL が要ります。そのためのページのひな形です（English: [README.en.md](README.en.md)）。

| ファイル          | 内容                           | ページ内のリンク               |
| ----------------- | ------------------------------ | ------------------------------ |
| `index.html`      | ホームページ（日本語）         | `privacy`、英語版 `index.en`   |
| `privacy.html`    | プライバシーポリシー（日本語） | `./`、英語版 `privacy.en`      |
| `index.en.html`   | ホームページ（英語）           | `privacy.en`、日本語版 `./`    |
| `privacy.en.html` | プライバシーポリシー（英語）   | `index.en`、日本語版 `privacy` |

## プレースホルダ

ページには次のプレースホルダがあります。値は言語ごとに書き方が違うので、日本語版と英語版を別々に置き換えます。値は HTML にそのまま入るので、`<`、`>`、`&` は `&lt;`、`&gt;`、`&amp;` と書きます。

| プレースホルダ       | 意味                                                                | 日本語版の例                     | 英語版の例                                      |
| -------------------- | ------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- |
| `{{APP_NAME}}`       | OAuth 同意画面のアプリ名と同じ名前                                  | `DSH bots`                       | `DSH bots`                                      |
| `{{OPERATOR}}`       | 運営者（DSH とボットを動かし、データを管理する人や団体）の名前      | `山田 太郎`                      | `Taro Yamada`                                   |
| `{{USERS}}`          | Google アカウントをつなぐ利用者の範囲。文の中に入る名詞句で書きます | `運営者本人`、`運営者とその家族` | `the operator`、`the operator and their family` |
| `{{CONTACT_EMAIL}}`  | 問い合わせ先のメールアドレス                                        | `bots@example.com`               | `bots@example.com`                              |
| `{{EFFECTIVE_DATE}}` | プライバシーポリシーの制定日                                        | `2026 年 11 月 24 日`            | `November 24, 2026`                             |

`{{USERS}}` は「{{USERS}}以外は利用できません」「本アプリを使うのは{{USERS}}だけです」（英語版は "only {{USERS}} can use it"、"used only by {{USERS}}"）の形で入ります。

## 置き方

1. ひな形を公開用のディレクトリに写し、プレースホルダを置き換えます。例（リポジトリのルートで、GNU sed）:

   ```sh
   mkdir -p site
   cp docs/google-oauth-pages/*.html site/
   sed -i \
     -e 's/{{APP_NAME}}/DSH bots/g' \
     -e 's/{{OPERATOR}}/山田 太郎/g' \
     -e 's/{{USERS}}/運営者本人/g' \
     -e 's/{{CONTACT_EMAIL}}/bots@example.com/g' \
     -e 's/{{EFFECTIVE_DATE}}/2026 年 11 月 24 日/g' \
     site/index.html site/privacy.html
   sed -i \
     -e 's/{{APP_NAME}}/DSH bots/g' \
     -e 's/{{OPERATOR}}/Taro Yamada/g' \
     -e 's/{{USERS}}/the operator/g' \
     -e 's/{{CONTACT_EMAIL}}/bots@example.com/g' \
     -e 's/{{EFFECTIVE_DATE}}/November 24, 2026/g' \
     site/index.en.html site/privacy.en.html
   grep -n '{{' site/*.html
   ```

   最後の `grep` が何も出さなければ、置き換え漏れはありません。値に `/` や `&` を含めるときは、sed の区切りや `\&` に気をつけます。

2. 誰でも見られる Web サーバーの、ログインの戻り先と同じドメインの下に置きます。例: `https://example.com/dsh-bots/`（`index.html`）と `https://example.com/dsh-bots/privacy`（`privacy.html`）。ページ内のリンクは拡張子なし（`privacy`、`index.en`、`privacy.en`）なので、`.html` を補って開けるサーバーに置くか、リンクを `.html` 付きに揃えます。
3. Google の **ブランディング** には、どちらか一方の言語のホームページとプライバシーポリシーの URL を入れます。片方の言語だけを置くときは、各ページの先頭の言語の切り替え（`<nav>`）を消します。
4. 手順は [google-connector-setup.md](../google-connector-setup.md) の 2 章を参照してください。
