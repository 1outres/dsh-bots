import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig, type Plugin } from "vitest/config"

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
    alias: [
      {
        find: /^@1outres\/(dsh-bot-connector-[a-z-]+)$/,
        replacement: fileURLToPath(new URL("./packages/$1/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/fixtures/**"],
  },
})
