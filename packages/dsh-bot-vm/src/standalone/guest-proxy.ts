/** ssh ProxyCommand of a bot VM: `guest-proxy.js <relay socket> <instance>` (src/host/guest-transport.ts). */
import { runGuestProxy } from "../node/guest-proxy-client"

const [socket, instance] = process.argv.slice(2)
if (socket === undefined || instance === undefined) {
  process.stderr.write("usage: guest-proxy.js <relay socket> <instance>\n")
  process.exit(255)
}
runGuestProxy(socket, instance, {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
}).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`dsh-bot-vm guest-proxy: ${String(error)}\n`)
    process.exit(255)
  },
)
