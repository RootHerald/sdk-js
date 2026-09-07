/**
 * Local verification of signatures made by a certified key.
 *
 * `verify` returns the key's public half as a JWK; the device later signs with
 * the private half, which never leaves its TPM. Checking such a signature needs
 * no RootHerald call and no key material beyond the JWK, so it is a pure
 * function over `node:crypto`.
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { CertifiedKey } from "@rootherald/contracts";

/** The public-key half of a {@link CertifiedKey}. */
export type CertifiedKeyJwk = CertifiedKey["jwk"];

/**
 * Verify an ES256 signature made by a certified key.
 *
 * - `message`: the bytes that were signed. A string is UTF-8 text — the same
 *   convention as `@rootherald/browser`'s `sign(key, data)`, so a page that
 *   signed `"hello"` is checked here with `"hello"`.
 * - `signature`: raw bytes, or a base64url (or base64) string as the client
 *   returns it. A 64-byte signature is read as IEEE P1363 `r || s`; any other
 *   length is read as ASN.1 DER.
 *
 * Returns `false`, never throws, for a malformed key, signature, or message:
 * a verifier that can throw is a verifier that can be made to skip a check.
 */
export function verifyKeySignature(
  jwk: CertifiedKeyJwk,
  message: Uint8Array | string,
  signature: Uint8Array | string,
): boolean {
  try {
    if (
      !jwk ||
      typeof jwk !== "object" ||
      jwk.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" ||
      typeof jwk.y !== "string"
    ) {
      return false;
    }
    const data = toMessageBytes(message);
    const sig = toSignatureBytes(signature);
    if (!data || !sig || sig.length === 0) return false;

    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      format: "jwk",
    });
    // P-256 fixed-width r || s is 64 bytes (96 would be P-384, not certified
    // today, but the encoding rule is the same).
    const dsaEncoding = sig.length === 64 || sig.length === 96 ? "ieee-p1363" : "der";
    return cryptoVerify("sha256", data, { key, dsaEncoding }, sig);
  } catch {
    return false;
  }
}

function toMessageBytes(message: Uint8Array | string): Buffer | undefined {
  if (typeof message === "string") return Buffer.from(message, "utf8");
  if (message instanceof Uint8Array) {
    return Buffer.from(message.buffer, message.byteOffset, message.byteLength);
  }
  return undefined;
}

function toSignatureBytes(signature: Uint8Array | string): Buffer | undefined {
  if (typeof signature === "string") {
    // Node's base64url decoder accepts both alphabets and ignores padding, so
    // a standard-base64 signature is accepted too. Anything else is rejected
    // rather than silently truncated.
    if (!/^[A-Za-z0-9_\-+/]*={0,2}$/.test(signature)) return undefined;
    return Buffer.from(signature, "base64url");
  }
  if (signature instanceof Uint8Array) {
    return Buffer.from(signature.buffer, signature.byteOffset, signature.byteLength);
  }
  return undefined;
}
