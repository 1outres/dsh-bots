import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  apiHeaders,
  contentHeaders,
  contentPolicy,
  hostSourceOf,
  preflightHeaders,
  wrapperHeaders,
} from "../src/host/spaces/headers"
import { WRAPPER_TEXTS } from "../src/host/spaces/texts"
import { WRAPPER_SCRIPT, wrapperHtml } from "../src/host/spaces/wrapper"

const TOKEN = "A".repeat(43)

describe("Space headers", () => {
  it("takes the source from the Host header and refuses odd ones", () => {
    expect(hostSourceOf("dsh.example:8443")).toBe("dsh.example:8443")
    expect(hostSourceOf("[::1]:3080")).toBe("[::1]:3080")
    expect(hostSourceOf(undefined)).toBeUndefined()
    expect(hostSourceOf("evil.example; script-src *")).toBeUndefined()
    expect(hostSourceOf("a b")).toBeUndefined()
  })

  it("confines the content to its own path, never 'self'", () => {
    const policy = contentPolicy("dsh.example", TOKEN)
    const base = `dsh.example/bot-spaces/s/${TOKEN}/`
    expect(policy).toContain("sandbox allow-scripts allow-forms;")
    expect(policy).toContain(`default-src ${base};`)
    expect(policy).toContain(`connect-src ${base}_dsh/;`)
    expect(policy).toContain(`form-action ${base}_dsh/;`)
    expect(policy).toContain("frame-ancestors 'self'")
    expect(policy).not.toContain("allow-same-origin")
    expect(policy.replace("frame-ancestors 'self'", "")).not.toContain("'self'")
  })

  it("sends content with the policy, an ETag and no-cache; the API with CORS and no-store", () => {
    expect(contentHeaders("h", TOKEN, { type: "text/css", etag: '"x"', bytes: 3 })).toMatchObject({
      "Cache-Control": "no-cache",
      ETag: '"x"',
      "Content-Length": "3",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    })
    expect(apiHeaders()).toMatchObject({
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    })
    expect(preflightHeaders()).toMatchObject({
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "600",
    })
  })

  it("lets the wrapper run only its fixed script and frame only its Space", () => {
    const hash = createHash("sha256").update(WRAPPER_SCRIPT).digest("base64")
    const policy = wrapperHeaders("h", TOKEN, hash)["Content-Security-Policy"]
    expect(policy).toContain(`script-src 'sha256-${hash}'`)
    expect(policy).toContain(`frame-src h/bot-spaces/s/${TOKEN}/`)
    expect(policy).toContain(`connect-src h/bot-spaces/v/${TOKEN}/_wrap/`)
    expect(policy).toContain("frame-ancestors 'none'")
    const html = wrapperHtml({
      token: TOKEN,
      botName: "<Mia>",
      title: "Plan",
      avatarDataUrl: "data:image/png;base64,AA",
      texts: WRAPPER_TEXTS.ja,
    })
    expect(html).toContain(`<script>${WRAPPER_SCRIPT}</script>`)
    expect(html).toContain("&lt;Mia&gt; が作ったページです")
    expect(html).toContain('sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"')
  })
})
