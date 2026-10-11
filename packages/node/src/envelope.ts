/**
 * Encrypt to a device's decrypt key.
 *
 * `certifyKey` returns the key's public half as a JWK; only the device's TPM
 * holds the private half, so anyone with the JWK can encrypt and only that
 * chip can open the result. The envelope is one JWE compact serialization
 * (RFC 7516): `ECDH-ES` with the Concat KDF for an EC P-256 key,
 * `RSA-OAEP-256` for an RSA key, `A256GCM` for the content in both cases.
 * The protected header carries `alg`, `enc` and (for `ECDH-ES`) `epk`, and
 * nothing else; the device's parser is a whitelist and refuses any other
 * member. Pure `node:crypto`, no RootHerald call.
 */

import {
  constants,
  createCipheriv,
  createECDH,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { RootHeraldError, type CertifiedKey, type CertifiedKeyJwk } from "@rootherald/contracts";

/**
 * A key `encryptToDevice` accepts: the `certifyKey` result (checked for
 * purpose and format) or its bare `jwk` (the algorithm follows from the key
 * type, and the caller vouches that it is a decrypt key).
 */
export type EncryptableKey = Pick<CertifiedKey, "purpose" | "alg" | "format" | "jwk"> | CertifiedKeyJwk;

/** The key cannot be encrypted to. `code` says why; the subclasses name the cases a caller routes on. */
export class EncryptToDeviceError extends RootHeraldError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = "EncryptToDeviceError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The key is a sign key (`ES256` / `RS256`, or purpose `sign`); it cannot decrypt. */
export class SignKeyError extends EncryptToDeviceError {
  constructor(message = "The key is a sign key; mint a key with purpose 'decrypt'") {
    super(message, "SIGN_KEY");
    this.name = "SignKeyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The key is a macOS decrypt key (`format: "apple-ecies"`). Its envelope is
 * Apple's ECIES from Security.framework, which this package does not produce;
 * encrypt to it with an Apple-side encryptor.
 */
export class AppleEciesKeyError extends EncryptToDeviceError {
  constructor(
    message = "The key is apple-ecies (a macOS Secure Enclave key); encryptToDevice produces JWE only, so encrypt to it with an Apple-side ECIES encryptor",
  ) {
    super(message, "APPLE_ECIES_KEY");
    this.name = "AppleEciesKeyError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const ENC = "A256GCM";
const CEK_BYTES = 32;
const IV_BYTES = 12;
const COORDINATE_BYTES = 32;
const MIN_RSA_MODULUS_BITS = 2048;
const UNCOMPRESSED_POINT = 0x04;

/** Bytes the envelope draws at random; the seam the known-answer tests replay. */
export type RandomSource = (byteLength: number) => Uint8Array;

/**
 * Encrypt `plaintext` so that only the device holding `key` can read it.
 *
 * - `key`: the `certifyKey` result for a `decrypt` key, or its `jwk`. A sign
 *   key, a macOS `apple-ecies` key, a curve other than P-256, or an RSA key
 *   under 2048 bits is refused with an {@link EncryptToDeviceError}.
 * - `plaintext`: bytes, or a string as UTF-8 text.
 *
 * Returns the JWE compact serialization the device's `Decrypt` takes. A fresh
 * ephemeral key (EC) or content key (RSA) and a fresh IV are drawn per call,
 * so encrypting the same bytes twice gives two different envelopes.
 */
export function encryptToDevice(key: EncryptableKey, plaintext: Uint8Array | string): string {
  return encryptToDeviceWith(randomBytes, key, plaintext);
}

/** {@link encryptToDevice} over a chosen random source: EC draws the 32-byte ephemeral scalar then the 12-byte IV; RSA the 32-byte CEK then the 12-byte IV. */
export function encryptToDeviceWith(
  random: RandomSource,
  key: EncryptableKey,
  plaintext: Uint8Array | string,
): string {
  const jwk = requireDecryptJwk(key);
  const data = toPlaintextBytes(plaintext);

  if (jwk.kty === "EC") {
    const recipient = requireP256Point(jwk);
    const ephemeral = createECDH("prime256v1");
    ephemeral.setPrivateKey(draw(random, COORDINATE_BYTES));
    const epk = ephemeral.getPublicKey(null, "uncompressed");
    const z = ephemeral.computeSecret(recipient);
    const cek = concatKdf(z, { algorithmId: ENC, apu: EMPTY, apv: EMPTY, keyBits: CEK_BYTES * 8 });
    const header = base64url(
      JSON.stringify({
        alg: "ECDH-ES",
        enc: ENC,
        epk: {
          kty: "EC",
          crv: "P-256",
          x: base64url(epk.subarray(1, 1 + COORDINATE_BYTES)),
          y: base64url(epk.subarray(1 + COORDINATE_BYTES)),
        },
      }),
    );
    return seal(header, EMPTY, cek, draw(random, IV_BYTES), data);
  }

  const publicKey = requireRsaKey(jwk);
  const cek = draw(random, CEK_BYTES);
  const encryptedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    cek,
  );
  const header = base64url(JSON.stringify({ alg: "RSA-OAEP-256", enc: ENC }));
  return seal(header, encryptedKey, cek, draw(random, IV_BYTES), data);
}

const EMPTY = Buffer.alloc(0);

/** AES-256-GCM over `data` with the base64url protected header as the AAD, assembled as compact JWE. */
function seal(header: string, encryptedKey: Buffer, cek: Buffer, iv: Buffer, data: Buffer): string {
  const cipher = createCipheriv("aes-256-gcm", cek, iv);
  cipher.setAAD(Buffer.from(header, "ascii"));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [header, base64url(encryptedKey), base64url(iv), base64url(ciphertext), base64url(tag)].join(".");
}

export interface ConcatKdfParams {
  /** The JWE `enc` name in direct key agreement; the `alg` name in key wrapping. */
  algorithmId: string;
  apu: Uint8Array;
  apv: Uint8Array;
  keyBits: number;
}

/**
 * The Concat KDF of RFC 7518 §4.6.2 (NIST SP 800-56A §5.8.1) with SHA-256:
 * `SHA-256(counter || Z || AlgorithmID || PartyUInfo || PartyVInfo || SuppPubInfo)`,
 * each `*Info` a 4-byte big-endian length then the bytes, `SuppPubInfo` the
 * key length in bits. One round covers up to 256 bits; more rounds
 * concatenate under an incremented counter.
 */
export function concatKdf(z: Uint8Array, params: ConcatKdfParams): Buffer {
  const otherInfo = Buffer.concat([
    lengthPrefixed(Buffer.from(params.algorithmId, "ascii")),
    lengthPrefixed(params.apu),
    lengthPrefixed(params.apv),
    uint32be(params.keyBits),
  ]);
  const keyBytes = params.keyBits / 8;
  const rounds = Math.ceil(keyBytes / 32);
  const out: Buffer[] = [];
  for (let counter = 1; counter <= rounds; counter++) {
    out.push(createHash("sha256").update(uint32be(counter)).update(z).update(otherInfo).digest());
  }
  return Buffer.concat(out).subarray(0, keyBytes);
}

function lengthPrefixed(bytes: Uint8Array): Buffer {
  return Buffer.concat([uint32be(bytes.length), bytes]);
}

function uint32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * The JWK to encrypt to, after the refusals: a certify result must say
 * purpose `decrypt`, alg `ECDH-ES` / `RSA-OAEP-256` and format `jwe`; a
 * bare JWK must be EC or RSA. The `alg` and `format` are checked, not
 * trusted: a sign key's public half would encrypt just as well and the
 * device would never be able to open the result.
 */
function requireDecryptJwk(key: EncryptableKey): CertifiedKeyJwk {
  if (!key || typeof key !== "object") {
    throw new EncryptToDeviceError("encryptToDevice: `key` must be a certified key or its JWK", "INVALID_KEY");
  }
  if ("jwk" in key) {
    if (key.purpose === "sign" || key.alg === "ES256" || key.alg === "RS256") throw new SignKeyError();
    if (key.purpose !== "decrypt") {
      throw new EncryptToDeviceError(
        `encryptToDevice: the key's purpose is ${JSON.stringify(key.purpose)}, not 'decrypt'`,
        "NOT_DECRYPT_KEY",
      );
    }
    if (key.format === "apple-ecies") throw new AppleEciesKeyError();
    if (key.format !== "jwe") {
      throw new EncryptToDeviceError(
        `encryptToDevice: the key's envelope format is ${JSON.stringify(key.format)}, not 'jwe'`,
        "UNSUPPORTED_FORMAT",
      );
    }
    return requireJwkShape(key.jwk, key.alg);
  }
  return requireJwkShape(key, undefined);
}

function requireJwkShape(jwk: unknown, alg: CertifiedKey["alg"] | undefined): CertifiedKeyJwk {
  if (!jwk || typeof jwk !== "object") {
    throw new EncryptToDeviceError("encryptToDevice: `jwk` is not an object", "INVALID_KEY");
  }
  const k = jwk as Record<string, unknown>;
  if (k.kty === "EC") {
    if (alg !== undefined && alg !== "ECDH-ES") {
      throw new EncryptToDeviceError(`encryptToDevice: alg ${alg} does not fit an EC key`, "INVALID_KEY");
    }
    if (k.crv !== "P-256") {
      throw new EncryptToDeviceError(
        `encryptToDevice: EC curve ${JSON.stringify(k.crv)} is not P-256; the device's Decrypt takes P-256 only`,
        "UNSUPPORTED_CURVE",
      );
    }
    if (typeof k.x !== "string" || typeof k.y !== "string") {
      throw new EncryptToDeviceError("encryptToDevice: EC JWK is missing `x` or `y`", "INVALID_KEY");
    }
    return { kty: "EC", crv: "P-256", x: k.x, y: k.y };
  }
  if (k.kty === "RSA") {
    if (alg !== undefined && alg !== "RSA-OAEP-256") {
      throw new EncryptToDeviceError(`encryptToDevice: alg ${alg} does not fit an RSA key`, "INVALID_KEY");
    }
    if (typeof k.n !== "string" || typeof k.e !== "string") {
      throw new EncryptToDeviceError("encryptToDevice: RSA JWK is missing `n` or `e`", "INVALID_KEY");
    }
    return { kty: "RSA", n: k.n, e: k.e };
  }
  throw new EncryptToDeviceError(
    `encryptToDevice: JWK kty ${JSON.stringify(k.kty)} is not EC or RSA`,
    "INVALID_KEY",
  );
}

/** The recipient's P-256 point as 0x04 || x || y, each coordinate exactly 32 bytes. Off-curve points fail in `computeSecret`. */
function requireP256Point(jwk: CertifiedKeyJwk & { kty: "EC" }): Buffer {
  const x = fromBase64url(jwk.x);
  const y = fromBase64url(jwk.y);
  if (!x || !y || x.length !== COORDINATE_BYTES || y.length !== COORDINATE_BYTES) {
    throw new EncryptToDeviceError(
      "encryptToDevice: EC JWK coordinates must each be exactly 32 bytes of base64url",
      "INVALID_KEY",
    );
  }
  const point = Buffer.concat([Buffer.from([UNCOMPRESSED_POINT]), x, y]);
  try {
    createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  } catch {
    throw new EncryptToDeviceError("encryptToDevice: EC JWK is not a point on P-256", "INVALID_KEY");
  }
  return point;
}

function requireRsaKey(jwk: CertifiedKeyJwk & { kty: "RSA" }): KeyObject {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  } catch {
    throw new EncryptToDeviceError("encryptToDevice: RSA JWK does not decode", "INVALID_KEY");
  }
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (typeof bits !== "number" || bits < MIN_RSA_MODULUS_BITS) {
    throw new EncryptToDeviceError(
      `encryptToDevice: RSA modulus is ${String(bits)} bits; at least ${MIN_RSA_MODULUS_BITS} are required`,
      "INVALID_KEY",
    );
  }
  return key;
}

function draw(random: RandomSource, byteLength: number): Buffer {
  const bytes = random(byteLength);
  if (!(bytes instanceof Uint8Array) || bytes.length !== byteLength) {
    throw new TypeError(`encryptToDevice: the random source returned ${String(bytes?.length)} bytes, not ${byteLength}`);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function toPlaintextBytes(plaintext: Uint8Array | string): Buffer {
  if (typeof plaintext === "string") return Buffer.from(plaintext, "utf8");
  if (plaintext instanceof Uint8Array) {
    return Buffer.from(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  }
  throw new TypeError("encryptToDevice: `plaintext` must be a Uint8Array or a string");
}

function base64url(bytes: Uint8Array | string): string {
  return (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)).toString("base64url");
}

/** Strict base64url: the URL alphabet, no padding. A coordinate in another encoding is not the server's. */
function fromBase64url(text: string): Buffer | undefined {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  return Buffer.from(text, "base64url");
}
