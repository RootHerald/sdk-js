/**
 * sign — sign with a certified key (host `LoadKey` / `Sign` / `CloseKey`).
 *
 * The page holds only the wrapped `KeyBlob` from an earlier `respond` to a
 * `"key"` ask. The host loads it back into the TPM that made it, signs there,
 * and releases it; the private half never leaves the TPM. The backend checks
 * the signature against the JWK it kept from `verify` — no RootHerald call.
 */

import type { KeyBlob } from '@rootherald/contracts';
import { ACTION_SIGN } from './constants.js';
import { HostMissingError } from './errors.js';
import { classifyFailure } from './host-error.js';
import { sendRequest, type MessageWindow } from './transport.js';

export interface SignOptions {
  /** Overall timeout (ms). Default 30000. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

export interface SignResult {
  /** The signature algorithm. `ES256` is the only one today. */
  alg: 'ES256';
  /**
   * base64url signature over `data`. ES256 as `r || s` (64 bytes) or DER,
   * whichever the host produced; `@rootherald/node`'s `verifyKeySignature`
   * accepts both.
   */
  signature: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Sign `data` with the key behind `key`.
 *
 * `data` is the bytes to sign. A string is UTF-8 text — the same convention as
 * `verifyKeySignature` on the backend, so a page that signs `"hello"` is
 * checked there with `"hello"`. On the wire the bytes travel base64url.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link KeyUnloadableError} if the blob could not be loaded into this TPM —
 *     ask the backend for a new `"key"` challenge and replace it
 *   - {@link AbiMismatchError} if the host is a different version than this SDK
 *   - {@link TimeoutError} if the host started but did not finish in time
 */
export async function sign(
  key: KeyBlob,
  data: Uint8Array | string,
  opts: SignOptions = {},
): Promise<SignResult> {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('sign: `key` must be the KeyBlob string from respond()');
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

  if (res === null || res.success !== true) {
    throw classifyFailure(res, 'signing');
  }

  const signature = res.data?.signature;
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new HostMissingError('Extension reported success but returned no signature');
  }
  const alg = res.data?.alg ?? 'ES256';
  if (alg !== 'ES256') {
    throw new HostMissingError(`Extension returned an unexpected signature algorithm: ${String(alg)}`);
  }
  return { alg, signature };
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
