import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig, type Plugin } from "vitest/config"

/** As esbuild's text loader in scripts/build-options.mjs: a .txt import is the file's text. */
const textFiles: Plugin = {
  name: "text-files",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(".txt")) return undefined
    return `export default ${JSON.stringify(await readFile(id, "utf8"))}`
  },
}

export default defineConfig({
  plugins: [textFiles],
  resolve: {
    // As tsconfig.json's paths, for the connector packages bot-core's connector-fit test registers.
    alias: [
      {
        find: /^@1outres\/(dsh-bot-connector-[a-z-]+)$/,
        replacement: fileURLToPath(new URL("./packages/$1/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // Lint fixtures are linted by test/design-rules.test.ts, never run.
    exclude: [...configDefaults.exclude, "test/fixtures/**"],
  },
})
