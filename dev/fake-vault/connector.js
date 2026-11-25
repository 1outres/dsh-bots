// Verification only. A connector whose tool takes one value of a login the
// way a browser connector would (run.vault.reveal for a page's origin) and
// only says how many bytes it got: it lets a verification DSH give a login
// to a connector and see the use recorded, without a browser.
export const vaultProbeConnector = {
  id: "vaultprobe",
  name: "Vault probe",
  sessions: "bot",
  tools: [
    {
      name: "fill",
      description:
        "Verification only: take one field of a login (its credential handle from credentials_list) for a page origin, as a browser connector would, and report how many bytes it got.",
      permission: "allow",
      vault: true,
      parameters: {
        credential: { type: "string", required: true },
        field: { type: "string", enum: ["username", "password", "otp"], required: true },
        origin: {
          type: "string",
          required: true,
          description: "The page origin, e.g. https://login.example.test",
        },
      },
      preview: (args) => ({
        title: `Fill ${args.field}`,
        fields: [{ label: "Origin", value: args.origin }],
      }),
      async execute(args, run) {
        const credential = await run.vault.describe(args.credential)
        const secret = await run.vault.reveal(args.credential, args.field, {
          kind: "browser",
          origin: args.origin,
        })
        const length = secret.length
        secret.wipe()
        return {
          text: `Took the ${args.field} of ${credential.label} for ${args.origin} (${length} bytes); nothing was typed.`,
        }
      },
    },
  ],
}
