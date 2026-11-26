#!/usr/bin/env node
import { existsSync } from "node:fs"
import { createTestSite, readJson } from "./server.js"

const argument = (name, otherwise) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? otherwise : process.argv[at + 1]
}

const itemsPath = argument("items", new URL("./items.example.json", import.meta.url).pathname)
const passkeysPath = argument("passkeys", undefined)
const site = createTestSite({
  items: readJson(itemsPath),
  passkeys: () =>
    passkeysPath !== undefined && existsSync(passkeysPath) ? readJson(passkeysPath) : [],
})
console.log(await site.listen(Number(argument("port", "8443")), argument("host", "localhost")))
