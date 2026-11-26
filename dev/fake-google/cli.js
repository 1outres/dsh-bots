#!/usr/bin/env node
import { createFakeGoogle } from "./server.js"

const argument = (name, otherwise) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? otherwise : process.argv[at + 1]
}

const fake = createFakeGoogle()
const origin = await fake.listen(Number(argument("port", "3399")), argument("host", "127.0.0.1"))
console.log(
  JSON.stringify({
    origin,
    clientId: fake.client.id,
    clientSecret: fake.client.secret,
    accounts: [...fake.accounts.keys()],
  }),
)
