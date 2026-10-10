/**
 * Local verification of signatures made by a certified key.
 *
 * `certifyKey` returns the key's public half as a JWK; the device later signs
 * with the private half, which never leaves its TPM. Checking such a signature
 * needs no RootHerald call and no key material beyond the JWK, so it is a pure
 * function over `node:crypto`.
 */

import { constants, createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import type { CertifiedKeyJwk } from "@rootherald/contracts";

export type { CertifiedKeyJwk } from "@rootherald/contracts";

const MIN_RSA_MODULUS_BITS = 2048;

/**
 * Verify a signature made by a certified sign key.
 *
 * - `jwk`: the key's public half, as `certifyKey` returned it. An EC P-256
 *   key checks ES256; an RSA key checks RS256 (PKCS#1 v1.5 over SHA-256).
 * - `message`: the bytes that were signed. A string is UTF-8 text — the same
 *   convention as `@rootherald/browser`'s `sign(key, data)`, so a page that
 *   signed `"hello"` is checked here with `"hello"`.
 * - `signature`: raw bytes, or a base64url (or base64) string as the client
 *   returns it. ES256: a 64-byte signature is read as IEEE P1363 `r || s`,
 *   any other length as ASN.1 DER. RS256: exactly the modulus length
 *   (256 bytes for RSA-2048).
 *
 * A signature proves possession of the key at that moment, not how the
 * machine booted; run an attest challenge for that.
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
    if (!jwk || typeof jwk !== "object") return false;
    const data = toMessageBytes(message);
    const sig = toSignatureBytes(signature);
    if (!data || !sig || sig.length === 0) return false;

    if (jwk.kty === "EC") return verifyEs256(jwk, data, sig);
    if (jwk.kty === "RSA") return verifyRs256(jwk, data, sig);
    return false;
  } catch {
    return false;
  }
}

function verifyEs256(jwk: CertifiedKeyJwk & { kty: "EC" }, data: Buffer, sig: Buffer): boolean {
  if (jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") return false;
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    format: "jwk",
  });
  const dsaEncoding = sig.length === 64 ? "ieee-p1363" : "der";
  return cryptoVerify("sha256", data, { key, dsaEncoding }, sig);
}

function verifyRs256(jwk: CertifiedKeyJwk & { kty: "RSA" }, data: Buffer, sig: Buffer): boolean {
  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") return false;
  const key: KeyObject = createPublicKey({
    key: { kty: "RSA", n: jwk.n, e: jwk.e },
    format: "jwk",
  });
  const modulusLength = key.asymmetricKeyDetails?.modulusLength;
  if (typeof modulusLength !== "number" || modulusLength < MIN_RSA_MODULUS_BITS) return false;
  if (sig.length !== modulusLength / 8) return false;
  return cryptoVerify("sha256", data, { key, padding: constants.RSA_PKCS1_PADDING }, sig);
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
