/**
 * sign — sign with a minted key (host `LoadKey` / `KeyInfo` / `Sign` / `CloseKey`).
 *
 * The page holds only the wrapped `KeyBlob` from an earlier `mintKey`. The
 * host hashes the data, loads the blob back into the TPM that made it, signs
 * there, and releases the key; the private half never leaves the TPM. The backend checks the signature against the JWK it kept
 * from `certifyKey` — no RootHerald call.
 */

import type { KeyBlob } from '@rootherald/contracts';
import { ACTION_SIGN } from './constants.js';
import { HostMissingError } from './errors.js';
import { failureOf, requireHostAbi } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

export interface SignOptions {
  /** Overall timeout (ms). Default 45000. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** The algorithms a minted sign key produces; the host reads it from the key. */
export type SignAlg = 'ES256' | 'RS256';

export interface SignResult {
  /** The signature algorithm, from the key: `ES256` for an EC key, `RS256` for an RSA key. */
  alg: SignAlg;
  /**
   * base64url signature over SHA-256 of `data`. ES256 as `r || s` (64 bytes);
   * RS256 as PKCS#1 v1.5 (256 bytes). `@rootherald/node`'s
   * `verifyKeySignature` accepts both.
   */
  signature: string;
}

// Above the extension's own 30 s host timeout for `sign`.
const DEFAULT_TIMEOUT_MS = 45_000;

const ALGS: readonly string[] = ['ES256', 'RS256'];

/**
 * Sign `data` with the key behind `key`.
 *
 * `data` is the bytes to sign. A string is UTF-8 text — the same convention as
 * `verifyKeySignature` on the backend, so a page that signs `"hello"` is
 * checked there with `"hello"`. On the wire the bytes travel base64url; the
 * host hashes them.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link KeyUnloadableError} if the blob could not be loaded into this TPM —
 *     mint a new key and replace it
 *   - {@link AbiMismatchError} if the host is a different version than this SDK
 *   - {@link TimeoutError} if the host started but did not finish in time
 */
export async function sign(
  key: KeyBlob,
  data: Uint8Array | string,
  opts: SignOptions = {},
): Promise<SignResult> {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('sign: `key` must be the KeyBlob string from mintKey()');
  }
  const bytes = toBytes(data);
  if (bytes === undefined) {
    throw new TypeError('sign: `data` must be a Uint8Array or a string');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_SIGN, keyBlob: key, data: toBase64Url(bytes) },
    { timeoutMs, win: opts.win },
  );

  if (res === TIMED_OUT || res.success !== true) {
    throw await failureOf(res, 'signing', opts.win);
  }
  requireHostAbi(res.data, { required: false });

  const signature = res.data?.signature;
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new HostMissingError('Extension reported success but returned no signature');
  }
  const alg = res.data?.alg;
  if (typeof alg !== 'string' || !ALGS.includes(alg)) {
    throw new HostMissingError(`Extension returned an unexpected signature algorithm: ${String(alg)}`);
  }
  return { alg: alg as SignAlg, signature };
}

function toBytes(data: Uint8Array | string): Uint8Array | undefined {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  return undefined;
}

/** base64url without padding, from bytes, with no Node-only APIs. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
