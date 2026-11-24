#!/usr/bin/env node
/**
 * Run the fake Google for a verification DSH:
 *   node dev/fake-google/cli.js --host 127.0.0.1 --port 3399
 * Prints the origin to set as the Google connector's development.googleOrigin,
 * and the fake OAuth client id and secret to enter in the dsh-bots settings.
 */
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
