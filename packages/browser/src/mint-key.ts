/**
 * mintKey — mint a device-bound key (host `MintKey`).
 *
 * The host creates a new key under the TPM's storage parent and has the
 * installation's AK certify it over the key challenge's nonce. The page gets
 * the certification, which the embedder's backend relays with
 * @rootherald/node `certifyKey`, and the wrapped key blob, which the page
 * keeps for `sign`. No posture is involved: a key is a property of the chip,
 * not of a boot.
 */

import type { AkBlob, KeyBlob, KeyCertification } from '@rootherald/contracts';
import { ACTION_MINT_KEY } from './constants.js';
import { HostMissingError } from './errors.js';
import { failureOf, requireHostAbi } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

export interface MintKeyOptions {
  /** This installation's AK blob, from `enroll()`. */
  ak: AkBlob;
  /** Overall timeout (ms). Default 75000 — an RSA key can take seconds to create. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** What {@link mintKey} resolves with. */
export interface MintKeyResult {
  /** The AK's certification of the new key, for the backend's certify leg. Relay it verbatim. */
  certification: KeyCertification;
  /**
   * The wrapped key. Keep it; it is the only handle to the key and no SDK
   * parses it. It is a credential: any code that can read it can sign with
   * the key.
   */
  key: KeyBlob;
}

// Above the extension's own host timeout for `mint-key`, so a slow host is
// reported by the extension rather than by this timer firing first.
const DEFAULT_TIMEOUT_MS = 75_000;
const KEY_CHALLENGE_PREFIX = 'rhk1c.';

/**
 * Mint a key for the purpose the key challenge names.
 *
 * `keyChallenge` is the `rhk1c.` string from the backend's
 * `issueKeyChallenge`, relayed verbatim. The host parses it for the nonce
 * and the purpose; the page does not need to. `ak` is the AK blob `enroll()`
 * returned.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link KeyUnloadableError} if `ak` will not load into this TPM — discard
 *     it, `enroll()`, retry once
 *   - {@link AskUnsupportedError} if this host cannot mint for the purpose
 *   - {@link AbiMismatchError} if the host is a different version than this SDK
 *   - {@link TimeoutError} if the host started but did not finish in time
 */
export async function mintKey(
  keyChallenge: string,
  opts: MintKeyOptions,
): Promise<MintKeyResult> {
  if (typeof keyChallenge !== 'string' || !keyChallenge.startsWith(KEY_CHALLENGE_PREFIX)) {
    throw new TypeError(
      'mintKey: `keyChallenge` must be the `rhk1c.` string from the backend, relayed verbatim',
    );
  }
  if (!opts || typeof opts.ak !== 'string' || opts.ak.length === 0) {
    throw new TypeError('mintKey: `ak` must be the AK blob string from enroll()');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_MINT_KEY, keyChallenge, akBlob: opts.ak },
    { timeoutMs, win: opts.win },
  );

  if (res === TIMED_OUT || res.success !== true) {
    throw await failureOf(res, 'minting a key', opts.win);
  }
  requireHostAbi(res.data, { required: false });

  const certification = res.data?.certification;
  if (!certification || typeof certification !== 'object') {
    throw new HostMissingError('Extension reported success but returned no certification');
  }
  const key = res.data?.keyBlob;
  if (typeof key !== 'string' || key.length === 0) {
    throw new HostMissingError('Extension reported success but returned no keyBlob');
  }
  return { certification, key };
}
