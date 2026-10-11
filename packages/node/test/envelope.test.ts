import { describe, it, expect } from "vitest";
import {
  constants,
  createDecipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import type { CertifiedKey, CertifiedKeyJwk } from "@rootherald/contracts";
import {
  AppleEciesKeyError,
  EncryptToDeviceError,
  SignKeyError,
  concatKdf,
  encryptToDevice,
  encryptToDeviceWith,
  type RandomSource,
} from "../src/envelope.js";

// ── The device side, in software ──────────────────────────────────────────
// What RootHeraldDecrypt does with the blob loaded: the same whitelist, the
// same KDF, the same AAD. A test that only round-trips through the SDK's own
// code would pass with any self-consistent mistake; this opens the envelope
// the way the C SDKs and the server's vectors do.

interface EcPair {
  jwk: CertifiedKeyJwk & { kty: "EC" };
  d: Buffer;
}
interface RsaPair {
  jwk: CertifiedKeyJwk & { kty: "RSA" };
  privateKey: KeyObject;
}

function makeEcPair(): EcPair {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  return { jwk: { kty: "EC", crv: "P-256", x: pub.x, y: pub.y }, d: Buffer.from(priv.d, "base64url") };
}

function makeRsaPair(modulusLength = 2048): RsaPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength });
  const pub = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  return { jwk: { kty: "RSA", n: pub.n, e: pub.e }, privateKey };
}

function decryptKey(jwk: CertifiedKeyJwk, format: CertifiedKey["format"] = "jwe"): CertifiedKey {
  return {
    deviceId: "alias-1",
    keyId: "key-1",
    purpose: "decrypt",
    alg: jwk.kty === "EC" ? "ECDH-ES" : "RSA-OAEP-256",
    format,
    jwk,
    hardwareBound: true,
    certifiedAt: "2026-10-10T00:00:00Z",
  };
}

function signKey(jwk: CertifiedKeyJwk): CertifiedKey {
  return {
    deviceId: "alias-1",
    keyId: "key-2",
    purpose: "sign",
    alg: jwk.kty === "EC" ? "ES256" : "RS256",
    jwk,
    hardwareBound: true,
    certifiedAt: "2026-10-10T00:00:00Z",
  };
}

interface Parsed {
  header: string;
  headerJson: Record<string, unknown>;
  encryptedKey: Buffer;
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

function parse(jwe: string): Parsed {
  const parts = jwe.split(".");
  expect(parts).toHaveLength(5);
  const [header, encryptedKey, iv, ciphertext, tag] = parts as [string, string, string, string, string];
  return {
    header,
    headerJson: JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>,
    encryptedKey: Buffer.from(encryptedKey, "base64url"),
    iv: Buffer.from(iv, "base64url"),
    ciphertext: Buffer.from(ciphertext, "base64url"),
    tag: Buffer.from(tag, "base64url"),
  };
}

function gcmOpen(cek: Buffer, p: Parsed, aad: string = p.header): Buffer {
  const d = createDecipheriv("aes-256-gcm", cek, p.iv);
  d.setAAD(Buffer.from(aad, "ascii"));
  d.setAuthTag(p.tag);
  return Buffer.concat([d.update(p.ciphertext), d.final()]);
}

/** ECDH-ES direct: Z from the recipient's scalar and the header's epk, Concat KDF to the CEK. */
function openEc(pair: EcPair, jwe: string): Buffer {
  const p = parse(jwe);
  expect(p.headerJson.alg).toBe("ECDH-ES");
  expect(p.encryptedKey).toHaveLength(0);
  const epk = p.headerJson.epk as { x: string; y: string };
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(pair.d);
  const z = ecdh.computeSecret(
    Buffer.concat([Buffer.from([4]), Buffer.from(epk.x, "base64url"), Buffer.from(epk.y, "base64url")]),
  );
  const cek = concatKdf(z, { algorithmId: "A256GCM", apu: new Uint8Array(0), apv: new Uint8Array(0), keyBits: 256 });
  return gcmOpen(cek, p);
}

/** RSA-OAEP-256 key wrapping: unwrap the CEK, then open. */
function openRsa(pair: RsaPair, jwe: string): Buffer {
  const p = parse(jwe);
  expect(p.headerJson.alg).toBe("RSA-OAEP-256");
  const cek = privateDecrypt(
    { key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    p.encryptedKey,
  );
  expect(cek).toHaveLength(32);
  return gcmOpen(cek, p);
}

/** A random source that hands out fixed bytes in order, so an envelope is reproducible. */
function scripted(...chunks: Uint8Array[]): RandomSource {
  const queue = [...chunks];
  return (n) => {
    const next = queue.shift();
    if (!next || next.length !== n) throw new Error(`scripted RNG: asked for ${n} bytes`);
    return next;
  };
}

const PLAINTEXT = "the session token only this device can read";

describe("encryptToDevice (EC P-256, ECDH-ES + A256GCM)", () => {
  const pair = makeEcPair();

  it("produces a compact JWE the device side opens, from the certified key", () => {
    const jwe = encryptToDevice(decryptKey(pair.jwk), PLAINTEXT);
    expect(openEc(pair, jwe).toString("utf8")).toBe(PLAINTEXT);
  });

  it("accepts the bare JWK and bytes in", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 253]);
    const jwe = encryptToDevice(pair.jwk, bytes);
    expect(new Uint8Array(openEc(pair, jwe))).toEqual(bytes);
  });

  it("accepts the certifyKey result shape with certifiedAt as a Date", () => {
    const result = { ...decryptKey(pair.jwk), certifiedAt: new Date() };
    expect(openEc(pair, encryptToDevice(result, "x")).toString("utf8")).toBe("x");
  });

  it("encrypts an empty plaintext", () => {
    const jwe = encryptToDevice(pair.jwk, new Uint8Array(0));
    expect(parse(jwe).ciphertext).toHaveLength(0);
    expect(openEc(pair, jwe)).toHaveLength(0);
  });

  it("differs on every call: a fresh ephemeral key and a fresh IV", () => {
    const a = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    const b = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    expect(a.header).not.toBe(b.header);
    expect((a.headerJson.epk as { x: string }).x).not.toBe((b.headerJson.epk as { x: string }).x);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("writes exactly the whitelisted header, in order, with nothing else", () => {
    const p = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    const epk = p.headerJson.epk as Record<string, string>;
    const expected = JSON.stringify({
      alg: "ECDH-ES",
      enc: "A256GCM",
      epk: { kty: "EC", crv: "P-256", x: epk.x, y: epk.y },
    });
    expect(Buffer.from(p.header, "base64url").toString("utf8")).toBe(expected);
    expect(Object.keys(p.headerJson)).toEqual(["alg", "enc", "epk"]);
    expect(Object.keys(epk)).toEqual(["kty", "crv", "x", "y"]);
    expect(Buffer.from(epk.x!, "base64url")).toHaveLength(32);
    expect(Buffer.from(epk.y!, "base64url")).toHaveLength(32);
    expect(p.header).not.toMatch(/[=+/]/);
  });

  it("uses a 12-byte IV, a 16-byte tag and an empty encrypted-key segment", () => {
    const jwe = encryptToDevice(pair.jwk, PLAINTEXT);
    const p = parse(jwe);
    expect(p.iv).toHaveLength(12);
    expect(p.tag).toHaveLength(16);
    expect(jwe.split(".")[1]).toBe("");
  });

  it("binds the protected header as the AAD", () => {
    const jwe = encryptToDevice(pair.jwk, PLAINTEXT);
    const p = parse(jwe);
    // Same JSON, different bytes: a reader that hashed the parsed header
    // instead of the base64url text would accept this.
    const reserialised = Buffer.from(JSON.stringify(p.headerJson, null, 1)).toString("base64url");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(pair.d);
    const epk = p.headerJson.epk as { x: string; y: string };
    const z = ecdh.computeSecret(
      Buffer.concat([Buffer.from([4]), Buffer.from(epk.x, "base64url"), Buffer.from(epk.y, "base64url")]),
    );
    const cek = concatKdf(z, { algorithmId: "A256GCM", apu: new Uint8Array(0), apv: new Uint8Array(0), keyBits: 256 });
    expect(gcmOpen(cek, p).toString("utf8")).toBe(PLAINTEXT);
    expect(() => gcmOpen(cek, p, reserialised)).toThrow();
    expect(() => gcmOpen(cek, p, "")).toThrow();
  });

  it("does not open under another device's key", () => {
    const other = makeEcPair();
    const jwe = encryptToDevice(pair.jwk, PLAINTEXT);
    expect(() => openEc(other, jwe)).toThrow();
  });

  it("is reproducible through the random seam, and consumes scalar then IV", () => {
    const scalar = randomBytes(32);
    const iv = randomBytes(12);
    const a = encryptToDeviceWith(scripted(scalar, iv), pair.jwk, PLAINTEXT);
    const b = encryptToDeviceWith(scripted(scalar, iv), pair.jwk, PLAINTEXT);
    expect(a).toBe(b);
    const p = parse(a);
    expect(p.iv.equals(iv)).toBe(true);
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(scalar);
    const epk = p.headerJson.epk as { x: string; y: string };
    expect(Buffer.from(epk.x, "base64url").equals(ecdh.getPublicKey(null, "uncompressed").subarray(1, 33))).toBe(true);
    expect(openEc(pair, a).toString("utf8")).toBe(PLAINTEXT);
  });
});

describe("encryptToDevice (RSA, RSA-OAEP-256 + A256GCM)", () => {
  const pair = makeRsaPair();

  it("produces a compact JWE the device side opens", () => {
    const jwe = encryptToDevice(decryptKey(pair.jwk), PLAINTEXT);
    expect(openRsa(pair, jwe).toString("utf8")).toBe(PLAINTEXT);
    expect(openRsa(pair, encryptToDevice(pair.jwk, PLAINTEXT)).toString("utf8")).toBe(PLAINTEXT);
  });

  it("differs on every call", () => {
    const a = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    const b = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    expect(a.encryptedKey.equals(b.encryptedKey)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("writes exactly { alg, enc } and no epk", () => {
    const p = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    expect(Buffer.from(p.header, "base64url").toString("utf8")).toBe('{"alg":"RSA-OAEP-256","enc":"A256GCM"}');
    expect(p.encryptedKey).toHaveLength(256);
    expect(p.iv).toHaveLength(12);
    expect(p.tag).toHaveLength(16);
  });

  it("binds the protected header as the AAD", () => {
    const p = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    const cek = privateDecrypt(
      { key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      p.encryptedKey,
    );
    expect(() => gcmOpen(cek, p, p.header + "A")).toThrow();
  });

  it("wraps with OAEP-SHA-256, not OAEP-SHA-1", () => {
    const p = parse(encryptToDevice(pair.jwk, PLAINTEXT));
    expect(() =>
      privateDecrypt(
        { key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
        p.encryptedKey,
      ),
    ).toThrow();
  });

  it("draws the CEK then the IV from the random seam", () => {
    const cek = randomBytes(32);
    const iv = randomBytes(12);
    const p = parse(encryptToDeviceWith(scripted(cek, iv), pair.jwk, PLAINTEXT));
    expect(p.iv.equals(iv)).toBe(true);
    const unwrapped = privateDecrypt(
      { key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      p.encryptedKey,
    );
    expect(unwrapped.equals(cek)).toBe(true);
  });
});

describe("encryptToDevice refusals", () => {
  const ec = makeEcPair();
  const rsa = makeRsaPair();

  it("refuses a sign key by purpose or alg", () => {
    expect(() => encryptToDevice(signKey(ec.jwk), "x")).toThrow(SignKeyError);
    expect(() => encryptToDevice(signKey(rsa.jwk), "x")).toThrow(SignKeyError);
    expect(() => encryptToDevice({ ...decryptKey(ec.jwk), alg: "ES256" }, "x")).toThrow(SignKeyError);
    expect(() => encryptToDevice({ ...decryptKey(ec.jwk), purpose: "sign" }, "x")).toThrow(SignKeyError);
  });

  it("refuses a certify response whose purpose is not decrypt", () => {
    const key = { ...decryptKey(ec.jwk), purpose: "attest" as unknown as "decrypt" };
    expect(() => encryptToDevice(key, "x")).toThrow(EncryptToDeviceError);
    expect(() => encryptToDevice(key, "x")).toThrow(/purpose/);
  });

  it("refuses an apple-ecies key by name", () => {
    const key = { ...decryptKey(ec.jwk, "apple-ecies"), hardwareBound: false };
    let caught: unknown;
    try {
      encryptToDevice(key, "x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AppleEciesKeyError);
    expect(caught).toBeInstanceOf(EncryptToDeviceError);
    expect((caught as Error).name).toBe("AppleEciesKeyError");
    expect((caught as AppleEciesKeyError).code).toBe("APPLE_ECIES_KEY");
    expect((caught as Error).message).toMatch(/apple-ecies/);
  });

  it("refuses a format other than jwe, including none", () => {
    const { format: _omitted, ...noFormat } = decryptKey(ec.jwk);
    expect(() => encryptToDevice(noFormat, "x")).toThrow(EncryptToDeviceError);
    expect(() => encryptToDevice(decryptKey(ec.jwk, "cms" as unknown as "jwe"), "x")).toThrow(/format/);
  });

  it("refuses an alg that does not fit the key family", () => {
    expect(() => encryptToDevice({ ...decryptKey(ec.jwk), alg: "RSA-OAEP-256" }, "x")).toThrow(EncryptToDeviceError);
    expect(() => encryptToDevice({ ...decryptKey(rsa.jwk), alg: "ECDH-ES" }, "x")).toThrow(EncryptToDeviceError);
  });

  it("refuses a P-384 key", () => {
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const pub = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const jwk = { kty: "EC", crv: "P-384", x: pub.x, y: pub.y } as unknown as CertifiedKeyJwk;
    expect(() => encryptToDevice(jwk, "x")).toThrow(/P-256/);
    expect(() => encryptToDevice(decryptKey(jwk), "x")).toThrow(/P-256/);
  });

  it("refuses EC coordinates that are not 32 bytes", () => {
    const short = { ...ec.jwk, x: Buffer.from(ec.jwk.x, "base64url").subarray(1).toString("base64url") };
    expect(() => encryptToDevice(short, "x")).toThrow(/32 bytes/);
    const long = { ...ec.jwk, y: Buffer.concat([Buffer.alloc(1), Buffer.from(ec.jwk.y, "base64url")]).toString("base64url") };
    expect(() => encryptToDevice(long, "x")).toThrow(/32 bytes/);
    const padded = { ...ec.jwk, x: ec.jwk.x + "=" };
    expect(() => encryptToDevice(padded, "x")).toThrow(/32 bytes/);
  });

  it("refuses a point that is not on P-256", () => {
    const y = Buffer.from(ec.jwk.y, "base64url");
    y[7] ^= 0x40;
    expect(() => encryptToDevice({ ...ec.jwk, y: y.toString("base64url") }, "x")).toThrow(/on P-256/);
  });

  it("refuses an RSA key under 2048 bits", () => {
    const small = makeRsaPair(1024);
    expect(() => encryptToDevice(small.jwk, "x")).toThrow(/2048/);
  });

  it("refuses a JWK of another family or no key at all", () => {
    expect(() => encryptToDevice({ kty: "oct", k: "AAAA" } as unknown as CertifiedKeyJwk, "x")).toThrow(EncryptToDeviceError);
    expect(() => encryptToDevice(undefined as unknown as CertifiedKeyJwk, "x")).toThrow(EncryptToDeviceError);
    expect(() => encryptToDevice({ ...decryptKey(ec.jwk), jwk: null as unknown as CertifiedKeyJwk }, "x")).toThrow(EncryptToDeviceError);
  });

  it("refuses a plaintext that is neither bytes nor a string", () => {
    expect(() => encryptToDevice(ec.jwk, 42 as unknown as string)).toThrow(TypeError);
  });

  it("refuses the key before touching the random source", () => {
    const touched = () => {
      throw new Error("drawn");
    };
    expect(() => encryptToDeviceWith(touched, signKey(ec.jwk), "x")).toThrow(SignKeyError);
  });
});

describe("Concat KDF (RFC 7518 Appendix C)", () => {
  // The RFC's ECDH-ES example: Alice's ephemeral key agreed with Bob's static
  // key, derived for A128GCM with apu "Alice" and apv "Bob".
  const ALICE_D = "0_NxaRPUMQoAJt50Gz8YiTr8gRTwyEaCumd-MToTmIo";
  const BOB = {
    x: "weNJy2HscCSM6AEDTDg04biOvhFhyyWvOHQfeF_PxMQ",
    y: "e8lnCO-AlStT-NJVX-crhB7QRYhiix03illJOVAOyck",
  };
  const Z = Buffer.from([
    158, 86, 217, 29, 129, 113, 53, 211, 114, 131, 66, 131, 191, 132, 38, 156, 251, 49, 110, 163, 218, 128, 106,
    72, 246, 218, 167, 121, 140, 254, 144, 196,
  ]);

  it("agrees the RFC's Z", () => {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(ALICE_D, "base64url"));
    const z = ecdh.computeSecret(
      Buffer.concat([Buffer.from([4]), Buffer.from(BOB.x, "base64url"), Buffer.from(BOB.y, "base64url")]),
    );
    expect(z.equals(Z)).toBe(true);
  });

  it("derives the RFC's key", () => {
    const key = concatKdf(Z, {
      algorithmId: "A128GCM",
      apu: Buffer.from("Alice", "utf8"),
      apv: Buffer.from("Bob", "utf8"),
      keyBits: 128,
    });
    expect(key.toString("base64url")).toBe("VqqN6vgjbSBcIijNcacQGg");
  });

  it("runs the RFC's example end to end through the seam, with the envelope's empty apu/apv", () => {
    // Bob's private half opens what Alice's scripted ephemeral produced.
    const bobPrivate = createPrivateKey({
      key: { kty: "EC", crv: "P-256", x: BOB.x, y: BOB.y, d: "VEmDZpDXXK8p8N0Cndsxs924q6nS1RXFASRl6BfUqdw" },
      format: "jwk",
    });
    const bob: EcPair = {
      jwk: { kty: "EC", crv: "P-256", x: BOB.x, y: BOB.y },
      d: Buffer.from((bobPrivate.export({ format: "jwk" }) as { d: string }).d, "base64url"),
    };
    const jwe = encryptToDeviceWith(scripted(Buffer.from(ALICE_D, "base64url"), Buffer.alloc(12, 7)), bob.jwk, "hi");
    const epk = parse(jwe).headerJson.epk as { x: string; y: string };
    expect(epk).toEqual({
      kty: "EC",
      crv: "P-256",
      x: "gI0GAILBdu7T53akrFmMyGcsF3n5dO7MmwNBHKW5SV0",
      y: "SLW_xSffzlPWrHEVI30DHM_4egVwt3NQqeUD7nMFpps",
    });
    expect(openEc(bob, jwe).toString("utf8")).toBe("hi");
  });
});
