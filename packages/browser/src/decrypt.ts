/**
 * decrypt — open an envelope with a minted decrypt key (host `LoadKey` /
 * `Decrypt` / `CloseKey`).
 *
 * The page holds the wrapped `KeyBlob` from an earlier `mintKey` with purpose
 * `decrypt`, and the envelope the backend made with `@rootherald/node`'s
 * `encryptToDevice`. The host loads the blob back into the TPM that made it,
 * runs the key agreement or RSA decryption there, and opens the content in
 * software; the private half never leaves the TPM.
 */

import type { DeviceEnvelope, KeyBlob } from '@rootherald/contracts';
import { ACTION_DECRYPT } from './constants.js';
import { HostMissingError } from './errors.js';
import { failureOf, requireHostAbi } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

export interface DecryptOptions {
  /** The wrapped decrypt key from `mintKey(..., { purpose: 'decrypt' })`. */
  key: KeyBlob;
  /** Overall timeout (ms). Default 45000. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

export interface DecryptResult {
  /** The bytes the backend encrypted. Text is UTF-8: `new TextDecoder().decode(plaintext)`. */
  plaintext: Uint8Array;
}

// Above the extension's own 30 s host timeout for `decrypt`.
const DEFAULT_TIMEOUT_MS = 45_000;

/** A JWE compact serialization has five base64url segments. */
const COMPACT_JWE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/;

/**
 * Open `envelope` with the key behind `key`.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link KeyUnloadableError} if the blob could not be loaded into this TPM —
 *     mint a new key and replace it
 *   - {@link InvalidArgumentError} if the blob is a sign key
 *   - {@link DecryptFailedError} if the envelope was not made for this key, was
 *     altered, or is not the one JWE shape the host accepts
 *   - {@link AbiMismatchError} if the host is a different version than this SDK
 *   - {@link TimeoutError} if the host started but did not finish in time
 */
export async function decrypt(
  envelope: DeviceEnvelope,
  opts: DecryptOptions,
): Promise<DecryptResult> {
  if (typeof envelope !== 'string' || !COMPACT_JWE.test(envelope)) {
    throw new TypeError('decrypt: `envelope` must be the compact JWE string from encryptToDevice()');
  }
  const key = opts?.key;
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError('decrypt: `key` must be the KeyBlob string from mintKey()');
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_DECRYPT, keyBlob: key, jwe: envelope },
    { timeoutMs, win: opts.win },
  );

  if (res === TIMED_OUT || res.success !== true) {
    throw await failureOf(res, 'decrypting', opts.win);
  }
  requireHostAbi(res.data, { required: false });

  const plaintext = res.data?.plaintext;
  if (typeof plaintext !== 'string') {
    throw new HostMissingError('Extension reported success but returned no plaintext');
  }
  const bytes = fromBase64Url(plaintext);
  if (bytes === undefined) {
    throw new HostMissingError('Extension returned plaintext that is not base64url');
  }
  return { plaintext: bytes };
}

/** base64url (padding and the standard alphabet tolerated) to bytes, with no Node-only APIs. */
export function fromBase64Url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_\-+/]*={0,2}$/.test(text)) return undefined;
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
