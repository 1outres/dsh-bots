import { describe, expect, it } from "vitest"
import { isOpId, secretReference } from "../src/op/reference"

const ref = { vaultId: "v1", itemId: "i1", fieldId: "password", kind: "password" as const }

describe("secretReference", () => {
  it("names one field, and the one-time code of an OTP field", () => {
    expect(secretReference(ref)).toBe("op://v1/i1/password")
    expect(secretReference({ ...ref, fieldId: "TOTP_abc", kind: "otp" })).toBe(
      "op://v1/i1/TOTP_abc?attribute=otp",
    )
  })

  it.each([
    { vaultId: "v1/other" },
    { itemId: "i1?attribute=otp" },
    { fieldId: "password/../x" },
    { fieldId: "one-time password" },
    { fieldId: "" },
    { fieldId: "x".repeat(65) },
    { vaultId: "'v1'" },
    { itemId: "i1\nop://x/y/z" },
  ])("refuses ids that could change the reference: %j", (change) => {
    expect(() => secretReference({ ...ref, ...change })).toThrow(/not a 1Password/)
  })

  it("refuses a passkey", () => {
    expect(() => secretReference({ ...ref, kind: "passkey" })).toThrow(/no passkey/)
  })

  it("accepts letters, digits and _ only", () => {
    expect(isOpId("abcXYZ019_")).toBe(true)
    expect(isOpId("a-b")).toBe(false)
    expect(isOpId(42)).toBe(false)
  })
})
