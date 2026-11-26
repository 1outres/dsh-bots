/**
 * A self-signed X.509 certificate with an EC P-384 key, as Incus clients use
 * (`incus remote add` makes the same kind). Node creates keys but no
 * certificates, so the certificate's DER is written here.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto"
import type { ClientIdentity } from "../host/pairing"

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size])
  const bytes: number[] = []
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

const tlv = (tag: number, ...content: Buffer[]) => {
  const body = Buffer.concat(content)
  return Buffer.concat([Buffer.from([tag]), length(body.length), body])
}
const sequence = (...content: Buffer[]) => tlv(0x30, ...content)
const set = (...content: Buffer[]) => tlv(0x31, ...content)
const explicit = (index: number, content: Buffer) => tlv(0xa0 | index, content)
const octets = (content: Buffer) => tlv(0x04, content)
const bits = (content: Buffer) => tlv(0x03, Buffer.from([0]), content)
const utf8 = (text: string) => tlv(0x0c, Buffer.from(text, "utf8"))
const boolean = (value: boolean) => tlv(0x01, Buffer.from([value ? 0xff : 0]))

function integer(value: Buffer): Buffer {
  let start = 0
  while (start < value.length - 1 && value[start] === 0) start++
  const trimmed = value.subarray(start)
  return tlv(
    0x02,
    (trimmed[0] as number) & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed,
  )
}

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split(".").map(Number) as [number, number, ...number[]]
  const bytes = [first * 40 + second]
  for (const arc of rest) {
    const chunk = [arc & 0x7f]
    for (let value = arc >>> 7; value > 0; value >>>= 7) chunk.unshift(0x80 | (value & 0x7f))
    bytes.push(...chunk)
  }
  return tlv(0x06, Buffer.from(bytes))
}

function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const year = date.getUTCFullYear()
  return year >= 1950 && year < 2050
    ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`, "ascii"))
    : tlv(0x18, Buffer.from(`${iso}Z`, "ascii"))
}

const ECDSA_SHA384 = "1.2.840.10045.4.3.3"
const COMMON_NAME = "2.5.4.3"
const KEY_USAGE = "2.5.29.15"
const EXTENDED_KEY_USAGE = "2.5.29.37"
const BASIC_CONSTRAINTS = "2.5.29.19"
const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2"
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1"

const VALIDITY_YEARS = 10
/** How far a VM host's clock may be behind this one: the certificate is valid from that long ago. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

export interface IdentityOptions {
  readonly commonName: string
  readonly now: Date
  /** "client" for Incus clients; "server" for test servers. */
  readonly usage: "client" | "server"
}

export function createSelfSignedIdentity(options: IdentityOptions): ClientIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" })
  const algorithm = sequence(oid(ECDSA_SHA384))
  const name = sequence(set(sequence(oid(COMMON_NAME), utf8(options.commonName))))
  const notBefore = new Date(options.now.getTime() - CLOCK_SKEW_MS)
  const notAfter = new Date(options.now)
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + VALIDITY_YEARS)
  const extension = (id: string, critical: boolean, value: Buffer) =>
    sequence(oid(id), ...(critical ? [boolean(true)] : []), octets(value))
  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))),
    integer(Buffer.concat([Buffer.from([0x01]), randomBytes(15)])),
    algorithm,
    name,
    sequence(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    explicit(
      3,
      sequence(
        // digitalSignature (+ keyAgreement for a server's ECDHE): bit string with unused bits.
        extension(
          KEY_USAGE,
          true,
          tlv(
            0x03,
            Buffer.from([
              options.usage === "client" ? 7 : 3,
              options.usage === "client" ? 0x80 : 0x88,
            ]),
          ),
        ),
        extension(
          EXTENDED_KEY_USAGE,
          false,
          sequence(oid(options.usage === "client" ? CLIENT_AUTH : SERVER_AUTH)),
        ),
        extension(BASIC_CONSTRAINTS, true, sequence()),
      ),
    ),
  )
  const signature = sign("sha384", tbs, { key: privateKey, dsaEncoding: "der" })
  const der = sequence(tbs, algorithm, bits(signature))
  const certificate = `-----BEGIN CERTIFICATE-----\n${der
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .replace(/\n?$/, "\n")}-----END CERTIFICATE-----\n`
  return {
    certificate,
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    fingerprint: createHash("sha256").update(der).digest("hex"),
  }
}

/** Lowercase hex SHA-256 of a PEM certificate's DER (how Incus names certificates). */
export function certificateFingerprint(pem: string): string {
  return createHash("sha256").update(new X509Certificate(pem).raw).digest("hex")
}
