import type { ProxmoxClient } from "./client"

const ATTEMPTS = 5
const TAKEN = /already exists|is already in use/i

export async function withNewVmid(
  client: ProxmoxClient,
  create: (vmid: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<number> {
  let last: unknown
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const vmid = await client.nextId(signal)
    try {
      await create(vmid)
      return vmid
    } catch (error) {
      if (!(error instanceof Error) || !TAKEN.test(error.message)) throw error
      last = error
    }
  }
  throw new Error(`no free VM id was found in ${ATTEMPTS} attempts: ${String(last)}`)
}
