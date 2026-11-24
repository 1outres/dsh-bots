# Branding pages for Google's OAuth consent screen

To use the connectors with a personal Google account, the OAuth consent screen has to be published to "In production", and publishing needs the URLs of a home page and a privacy policy under **Branding**. These are templates for those pages (日本語: [README.md](README.md)).

| File              | Content                   | Links in the page              |
| ----------------- | ------------------------- | ------------------------------ |
| `index.html`      | Home page (Japanese)      | `privacy`, English `index.en`  |
| `privacy.html`    | Privacy policy (Japanese) | `./`, English `privacy.en`     |
| `index.en.html`   | Home page (English)       | `privacy.en`, Japanese `./`    |
| `privacy.en.html` | Privacy policy (English)  | `index.en`, Japanese `privacy` |

## Placeholders

The pages contain the placeholders below. Values are written differently per language, so replace them in the Japanese and the English pages separately. Values go into the HTML as they are: write `<`, `>` and `&` as `&lt;`, `&gt;` and `&amp;`.

| Placeholder          | Meaning                                                                             | Example (English)                               |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------- |
| `{{APP_NAME}}`       | The same name as the app name on the OAuth consent screen                           | `DSH bots`                                      |
| `{{OPERATOR}}`       | The operator: the person or organization running DSH and the bots, holding the data | `Taro Yamada`                                   |
| `{{USERS}}`          | Who connects Google accounts, as a noun phrase that fits into a sentence            | `the operator`, `the operator and their family` |
| `{{CONTACT_EMAIL}}`  | Contact email address                                                               | `bots@example.com`                              |
| `{{EFFECTIVE_DATE}}` | Effective date of the privacy policy                                                | `November 24, 2026`                             |

`{{USERS}}` appears as "only {{USERS}} can use it" and "used only by {{USERS}}". Japanese examples are in [README.md](README.md).

## Publishing

1. Copy the templates to a directory to publish and replace the placeholders. For example (at the repository root, GNU sed):

   ```sh
   mkdir -p site
   cp docs/google-oauth-pages/index.en.html docs/google-oauth-pages/privacy.en.html site/
   sed -i \
     -e 's/{{APP_NAME}}/DSH bots/g' \
     -e 's/{{OPERATOR}}/Taro Yamada/g' \
     -e 's/{{USERS}}/the operator/g' \
     -e 's/{{CONTACT_EMAIL}}/bots@example.com/g' \
     -e 's/{{EFFECTIVE_DATE}}/November 24, 2026/g' \
     site/index.en.html site/privacy.en.html
   grep -n '{{' site/*.html
   ```

   When the last `grep` prints nothing, every placeholder is replaced. Mind sed's delimiter and `\&` when a value contains `/` or `&`.

2. Put them on a publicly reachable web server, under the same domain as the sign-in redirect. For example `https://example.com/dsh-bots/index.en` and `https://example.com/dsh-bots/privacy.en`. Links in the pages have no extension (`privacy.en`, `index.en`), so serve the files from a server that resolves `.html`, or change the links to end in `.html`.
3. Under Google's **Branding**, enter the home page and privacy policy URLs of one language. When you publish only one language (as in the example above), remove the language switch (`<nav>`) at the top of each page.
4. For the whole procedure, see chapter 2 of [google-connector-setup.md](../google-connector-setup.md) (Japanese).
