/**
 * setUp — enroll, attest, then mint a key, in one call.
 *
 * The three ceremonies each need the device in between two backend calls, so
 * only the page can chain them. The backend side is four small handlers over
 * @rootherald/node; the one rule that makes the chain mean something is in
 * `relay.keyChallenge`: the backend issues the key challenge with
 * `expectedDevices: [alias]`, the alias of the device whose verdict it just
 * accepted, so the key provably comes from the device that passed. The alias
 * never reaches the page.
 */

import type { EvidenceBlob, KeyBlob, KeyCertification, KeyPurpose } from '@rootherald/contracts';
import { attest } from './attest.js';
import { enroll, type EnrollRelay, type EnrollResult } from './enroll.js';
import { NotAttestedError } from './errors.js';
import { mintKey } from './mint-key.js';
import type { MessageWindow } from './transport.js';

/**
 * The embedder's bridge to its OWN backend for all three ceremonies. Each
 * callback POSTs to the embedder's backend, which calls the matching
 * @rootherald/node verb with its `rh_sk_` secret.
 */
export interface SetUpRelay<R extends { pass: boolean } = { pass: boolean }> extends EnrollRelay {
  /**
   * Your backend calls `issueChallenge({ ask: [...] })` and returns its
   * `{ nonce, challenge }`. The ask is the backend's choice.
   */
  challenge(): Promise<{ nonce: string; challenge: string }>;
  /**
   * Your backend calls `verify(evidence, { nonce })`, keeps the verdict and
   * its `device.ueid` (the alias) for the next step, and returns at least
   * `{ pass: boolean }`. Anything else in the result is yours; `setUp`
   * returns it as `verified`.
   */
  verify(nonce: string, evidence: EvidenceBlob): Promise<R>;
  /**
   * Your backend calls `issueKeyChallenge({ purpose, expectedDevices:
   * [alias] })` with the alias from the verdict it just accepted and returns
   * its `{ nonce, keyChallenge }`.
   */
  keyChallenge(purpose: KeyPurpose): Promise<{ nonce: string; keyChallenge: string }>;
  /**
   * Your backend calls `certifyKey(nonce, certification)` and stores the
   * returned `keyId` and `jwk` against the alias. The return value is ignored.
   */
  certify(nonce: string, certification: KeyCertification): Promise<unknown>;
}

export interface SetUpOptions {
  /** What the minted key is for. `'sign'` in 8.0. */
  purpose: KeyPurpose;
  /** Overall timeout (ms) per native-host leg. Default: each verb's own. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** What {@link setUp} resolves with. */
export interface SetUpResult<R> extends EnrollResult {
  /** The wrapped key the page keeps, for `sign`. */
  key: KeyBlob;
  /** What `relay.verify` returned. */
  verified: R;
}

/**
 * Enroll this installation, prove it with an attest challenge, and mint a
 * key for it, chained: `enroll` → `relay.challenge` → `attest` →
 * `relay.verify` → `relay.keyChallenge` → `mintKey` → `relay.certify`.
 *
 * Resolves with the AK blob and the key blob, both of which the page keeps.
 * Throws {@link NotAttestedError} when `relay.verify` reports `pass: false`;
 * the installation is enrolled, and no key was minted. Every other error is
 * the underlying verb's.
 */
export async function setUp<R extends { pass: boolean } = { pass: boolean }>(
  relay: SetUpRelay<R>,
  opts: SetUpOptions,
): Promise<SetUpResult<R>> {
  if (
    !relay ||
    typeof relay.challenge !== 'function' ||
    typeof relay.verify !== 'function' ||
    typeof relay.keyChallenge !== 'function' ||
    typeof relay.certify !== 'function'
  ) {
    throw new TypeError(
      'setUp: `relay` must provide `enroll`, `activate`, `challenge`, `verify`, `keyChallenge` and `certify` callbacks that bridge to your backend',
    );
  }
  if (!opts || (opts.purpose !== 'sign' && opts.purpose !== 'decrypt')) {
    throw new TypeError("setUp: `purpose` must be 'sign' or 'decrypt'");
  }
  const legOpts = { timeoutMs: opts.timeoutMs, win: opts.win };

  const { ak } = await enroll(relay, legOpts);

  const { nonce, challenge } = await relay.challenge();
  const { evidence } = await attest(challenge, { ak, ...legOpts });
  const verified = await relay.verify(nonce, evidence);
  if (!verified || verified.pass !== true) {
    throw new NotAttestedError();
  }

  const kc = await relay.keyChallenge(opts.purpose);
  const { certification, key } = await mintKey(kc.keyChallenge, { ak, ...legOpts });
  await relay.certify(kc.nonce, certification);

  return { ak, key, verified };
}
