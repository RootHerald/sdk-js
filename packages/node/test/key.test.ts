import { describe, it, expect } from "vitest";
import { constants, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { verifyKeySignature, type CertifiedKeyJwk } from "../src/key.js";

/** A locally generated P-256 pair standing in for a TPM-certified key. */
function makeEcKey(): { jwk: CertifiedKeyJwk & { kty: "EC" }; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const exported = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  return {
    jwk: { kty: "EC", crv: "P-256", x: exported.x, y: exported.y },
    privateKey,
  };
}

/** A locally generated RSA pair standing in for a TPM-certified RSA key. */
function makeRsaKey(modulusLength = 2048): { jwk: CertifiedKeyJwk & { kty: "RSA" }; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength });
  const exported = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  return {
    jwk: { kty: "RSA", n: exported.n, e: exported.e },
    privateKey,
  };
}

function signEc(privateKey: KeyObject, data: Buffer, dsaEncoding: "der" | "ieee-p1363"): Buffer {
  return sign("sha256", data, { key: privateKey, dsaEncoding });
}

function signRsa(privateKey: KeyObject, data: Buffer, padding = constants.RSA_PKCS1_PADDING): Buffer {
  return sign("sha256", data, { key: privateKey, padding });
}

const MESSAGE = "the quick brown fox";
const MESSAGE_BYTES = Buffer.from(MESSAGE, "utf8");

describe("verifyKeySignature (ES256)", () => {
  const { jwk, privateKey } = makeEcKey();

  it("verifies a P1363 (r || s, 64-byte) signature, bytes in", () => {
    const sig = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363");
    expect(sig.length).toBe(64);
    expect(verifyKeySignature(jwk, new Uint8Array(MESSAGE_BYTES), new Uint8Array(sig))).toBe(true);
  });

  it("verifies a DER signature, bytes in", () => {
    const sig = signEc(privateKey, MESSAGE_BYTES, "der");
    expect(sig.length).not.toBe(64);
    expect(verifyKeySignature(jwk, new Uint8Array(MESSAGE_BYTES), new Uint8Array(sig))).toBe(true);
  });

  it("accepts the message as a UTF-8 string and the signature as base64url", () => {
    const p1363 = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363").toString("base64url");
    const der = signEc(privateKey, MESSAGE_BYTES, "der").toString("base64url");
    expect(verifyKeySignature(jwk, MESSAGE, p1363)).toBe(true);
    expect(verifyKeySignature(jwk, MESSAGE, der)).toBe(true);
  });

  it("accepts a standard-base64 signature too", () => {
    const b64 = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363").toString("base64");
    expect(verifyKeySignature(jwk, MESSAGE, b64)).toBe(true);
  });

  it("handles a Uint8Array view with a non-zero byte offset", () => {
    const sig = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363");
    const padded = Buffer.concat([Buffer.from("xxxx"), MESSAGE_BYTES]);
    const view = new Uint8Array(padded.buffer, padded.byteOffset + 4, MESSAGE_BYTES.length);
    expect(verifyKeySignature(jwk, view, new Uint8Array(sig))).toBe(true);
  });

  it("rejects a signature over a different message", () => {
    const sig = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363");
    expect(verifyKeySignature(jwk, "the quick brown fax", sig)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = makeEcKey();
    const sig = signEc(other.privateKey, MESSAGE_BYTES, "ieee-p1363");
    expect(verifyKeySignature(jwk, MESSAGE, sig)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const sig = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363");
    sig[10] ^= 0x01;
    expect(verifyKeySignature(jwk, MESSAGE, sig)).toBe(false);
  });

  it("returns false, without throwing, on malformed input", () => {
    const sig = signEc(privateKey, MESSAGE_BYTES, "ieee-p1363").toString("base64url");
    expect(verifyKeySignature(jwk, MESSAGE, "")).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, "not base64!!")).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, "AAAA")).toBe(false); // too short to be anything
    expect(verifyKeySignature(jwk, MESSAGE, new Uint8Array(70))).toBe(false); // garbage DER
    expect(verifyKeySignature({ ...jwk, x: "@@@" }, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature({ ...jwk, crv: "P-384" as "P-256" }, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature({ kty: "OKP" } as unknown as CertifiedKeyJwk, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature(undefined as unknown as CertifiedKeyJwk, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature(jwk, undefined as unknown as string, sig)).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, undefined as unknown as string)).toBe(false);
    expect(verifyKeySignature(jwk, 42 as unknown as string, sig)).toBe(false);
  });
});

describe("verifyKeySignature (RS256)", () => {
  const { jwk, privateKey } = makeRsaKey();

  it("verifies a PKCS#1 v1.5 signature of exactly the modulus length", () => {
    const sig = signRsa(privateKey, MESSAGE_BYTES);
    expect(sig.length).toBe(256);
    expect(verifyKeySignature(jwk, MESSAGE, sig)).toBe(true);
    expect(verifyKeySignature(jwk, MESSAGE, sig.toString("base64url"))).toBe(true);
  });

  it("rejects a signature over a different message or from a different key", () => {
    const sig = signRsa(privateKey, MESSAGE_BYTES);
    expect(verifyKeySignature(jwk, "the quick brown fax", sig)).toBe(false);
    const other = makeRsaKey();
    expect(verifyKeySignature(jwk, MESSAGE, signRsa(other.privateKey, MESSAGE_BYTES))).toBe(false);
  });

  it("rejects a PSS signature", () => {
    const sig = signRsa(privateKey, MESSAGE_BYTES, constants.RSA_PKCS1_PSS_PADDING);
    expect(verifyKeySignature(jwk, MESSAGE, sig)).toBe(false);
  });

  it("rejects a signature that is not the modulus length", () => {
    const sig = signRsa(privateKey, MESSAGE_BYTES);
    expect(verifyKeySignature(jwk, MESSAGE, sig.subarray(1))).toBe(false);
    expect(verifyKeySignature(jwk, MESSAGE, Buffer.concat([sig, Buffer.from([0])]))).toBe(false);
  });

  it("rejects a key below 2048 bits", () => {
    const small = makeRsaKey(1024);
    const sig = signRsa(small.privateKey, MESSAGE_BYTES);
    expect(sig.length).toBe(128);
    expect(verifyKeySignature(small.jwk, MESSAGE, sig)).toBe(false);
  });

  it("returns false, without throwing, on a malformed RSA JWK", () => {
    const sig = signRsa(privateKey, MESSAGE_BYTES);
    expect(verifyKeySignature({ ...jwk, n: "@@@" }, MESSAGE, sig)).toBe(false);
    expect(verifyKeySignature({ kty: "RSA", n: jwk.n } as unknown as CertifiedKeyJwk, MESSAGE, sig)).toBe(false);
  });
});
