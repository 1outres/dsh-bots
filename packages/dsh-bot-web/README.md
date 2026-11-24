# @1outres/dsh-bot-web

Host-only plugin (row id `bot-web`) that registers **Exa** as the web backend of every bot (`Bot.registerWebBackend` of `@1outres/dsh-bot-core`): each bot's `web_search` and `web_fetch` go through Exa, with the Exa API key set for the bots in the dsh-bots settings → **Web lookup**. The Host's own web settings and keys (the Web search settings page, `EXA_API_KEY`, `DSH_WEB_*`) are never used.

- **Search**: `POST /search` (`type: auto`, highlights of at most 1000 characters, at most 100 results; `maxResults` of the request, 10 when absent). One source per URL in Exa's order; the first highlight is the snippet, all of them joined by `…` the summary. Exa's notices are added to the answer, its warnings go to the Host's log.
- **Fetch**: `POST /contents` (text of at most 100000 characters, `truncated` beyond). Exa's servers fetch the target URL, neither the bot's VM nor the Host. A page that failed with an HTTP status is a result with that status and an empty body; any other failure is `WEB_PROVIDER_ERROR`.
- **Connection test**: one search (`numResults: 1`), billed as one: 401/403 → invalid key, 402 → no credits, 429 → rate limited.
- **Errors**: `WEB_PROVIDER_ERROR` with a sentence per cause (refused key, no credits, rate limit, other HTTP status, unreachable, malformed answer), `WEB_ABORTED` when cancelled. No message carries the key.

The search options are fixed (`EXA_OPTIONS`, `src/exa/options.ts`); neither the settings screen nor the row config sets them.

## Layout

`src/exa/` is a library of its own: it imports only `@deepseek-ai/dsh-web`'s types and `WebError`, never DSH services or bot-core. `request.ts` and `map.ts` are pure (requests from `WebSearchRequest` / `WebFetchRequest`; Exa's untrusted JSON to `WebSearchResult` / `WebFetchResult`), `failure.ts` words and classifies failures, `client.ts` sends (`x-api-key`, `redirect: "error"`, response at most 16 MiB) with the `fetch` it is given, `exa.ts` puts them together. `src/index.ts` alone connects it to bot-core.

## Config

| Field     | Default              | Meaning                                                                         |
| --------- | -------------------- | ------------------------------------------------------------------------------- |
| `baseURL` | `https://api.exa.ai` | Hidden. Only for a verification profile that points the bots at a fake Exa API. |
