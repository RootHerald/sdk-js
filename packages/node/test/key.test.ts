import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { verifyKeySignature, type CertifiedKeyJwk } from "../src/key.js";

/** A locally generated P-256 pair standing in for a TPM-certified key. */
function makeKey(): { jwk: CertifiedKeyJwk; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const exported = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  return {
    jwk: { kty: "EC", crv: "P-256", x: exported.x, y: exported.y },
    privateKey,
  };
}

function signWith(privateKey: KeyObject, data: Buffer, dsaEncoding: "der" | "ieee-p1363"): Buffer {
  return sign("sha256", data, { key: privateKey, dsaEncoding });
}

const MESSAGE = "the quick brown fox";
const MESSAGE_BYTES = Buffer.from(MESSAGE, "utf8");

describe("verifyKeySignature", () => {
  const { jwk, privateKey } = makeKey();

  it("verifies a P1363 (r || s, 64-byte) signature, bytes in", () => {
    const sig = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363");
    expect(sig.length).toBe(64);
    expect(verifyKeySignature(jwk, new Uint8Array(MESSAGE_BYTES), new Uint8Array(sig))).toBe(true);
  });

  it("verifies a DER signature, bytes in", () => {
    const sig = signWith(privateKey, MESSAGE_BYTES, "der");
    expect(sig.length).not.toBe(64);
    expect(verifyKeySignature(jwk, new Uint8Array(MESSAGE_BYTES), new Uint8Array(sig))).toBe(true);
  });

  it("accepts the message as a UTF-8 string and the signature as base64url", () => {
    const p1363 = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363").toString("base64url");
    const der = signWith(privateKey, MESSAGE_BYTES, "der").toString("base64url");
    expect(verifyKeySignature(jwk, MESSAGE, p1363)).toBe(true);
    expect(verifyKeySignature(jwk, MESSAGE, der)).toBe(true);
  });

  it("accepts a standard-base64 signature too", () => {
    const b64 = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363").toString("base64");
    expect(verifyKeySignature(jwk, MESSAGE, b64)).toBe(true);
  });

  it("handles a Uint8Array view with a non-zero byte offset", () => {
    const sig = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363");
    const padded = Buffer.concat([Buffer.from("xxxx"), MESSAGE_BYTES]);
    const view = new Uint8Array(padded.buffer, padded.byteOffset + 4, MESSAGE_BYTES.length);
    expect(verifyKeySignature(jwk, view, new Uint8Array(sig))).toBe(true);
  });

  it("rejects a signature over a different message", () => {
    const sig = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363");
    expect(verifyKeySignature(jwk, "the quick brown fax", sig)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = makeKey();
    const sig = signWith(other.privateKey, MESSAGE_BYTES, "ieee-p1363");
    expect(verifyKeySignature(jwk, MESSAGE, sig)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const sig = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363");
    sig[10] ^= 0x01;
    expect(verifyKeySignature(jwk, MESSAGE, sig)).toBe(false);
  });

  it("returns false, without throwing, on malformed input", () => {
    const sig = signWith(privateKey, MESSAGE_BYTES, "ieee-p1363").toString("base64url");
    expect(verifyKeySignature(jwk, MESSAGE, "")).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, "not base64!!")).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, "AAAA")).toBe(false); // too short to be anything
    expect(verifyKeySignature(jwk, MESSAGE, new Uint8Array(70))).toBe(false); // garbage DER
    expect(verifyKeySignature({ ...jwk, x: "@@@" }, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature({ ...jwk, crv: "P-384" as "P-256" }, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature({ ...jwk, kty: "RSA" as "EC" }, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature(undefined as unknown as CertifiedKeyJwk, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature(jwk, undefined as unknown as string, sig)).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, undefined as unknown as string)).toBe(false);
    expect(verifyKeySignature(jwk, 42 as unknown as string, sig)).toBe(false);
  });
});
