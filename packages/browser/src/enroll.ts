/**
 * Device enrollment — orchestrate the keyless, backend-relayed enroll handshake.
 *
 * Each installation enrolls once before it can {@link import('./attest.js').attest}
 * or {@link import('./mint-key.js').mintKey}. Enrollment is a two-leg
 * credential-activation handshake on the native host: `EnrollBegin` creates
 * this installation's attestation key under the TPM's storage parent and
 * hands it back wrapped, then `EnrollComplete` runs `TPM2_ActivateCredential`
 * with it. On Windows the second leg needs one elevation per enrollment.
 *
 * KEYLESS: the page holds no RootHerald key and never talks to RootHerald. The
 * two network legs are RELAYED by the embedder's backend. This SDK calls back
 * into embedder-provided `relay.enroll` / `relay.activate`, which POST the opaque
 * blobs to the embedder's OWN backend; that backend uses @rootherald/node's
 * `relayEnroll` / `relayActivate` (with its `rh_sk_` secret) to reach RootHerald.
 *
 * Flow:
 *   1. `enroll-begin` {}                         -> { enrollBody, akBlob }         (host EnrollBegin)
 *   2. relay.enroll(enrollBody)                  -> RelayEnrollResult { challenge }
 *   3. `enroll-complete` { challenge, akBlob }   -> { activationBlob }           (host EnrollComplete)
 *   4. relay.activate(activationBlob)            -> done
 *
 * The page keeps `akBlob` and passes it to every attest and mint. Nothing
 * the server assigns comes back to the page: the device's alias is returned
 * to the backend by `relayActivate` and stays there.
 */

import type {
  AkBlob,
  EnrollRequestBlob,
  EnrollActivationResponse,
} from '@rootherald/contracts';
import type {
  RelayEnrollResult,
  RelayActivateResponse,
} from '@rootherald/contracts/server';
import { ACTION_ENROLL_BEGIN, ACTION_ENROLL_COMPLETE } from './constants.js';
import { HostMissingError } from './errors.js';
import { failureOf, requireHostAbi } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

/**
 * The embedder's bridge to its OWN backend. These callbacks are how the keyless
 * browser SDK reaches RootHerald without holding a key: each one POSTs an opaque
 * blob to the embedder's backend, which relays it to RootHerald with `rh_sk_`
 * (via @rootherald/node) and returns the result.
 */
export interface EnrollRelay {
  /**
   * Relay leg 1. POST `enrollBody` to your backend, which calls
   * @rootherald/node `relayEnroll(blob)` and returns its
   * {@link RelayEnrollResult}. Admission runs under the identity policy bound
   * to the backend's API key.
   */
  enroll(enrollBody: EnrollRequestBlob): Promise<RelayEnrollResult>;
  /**
   * Relay leg 2. POST the `activationBlob` to your backend, which calls
   * @rootherald/node `relayActivate(blob)`. The return value is ignored;
   * resolve however your transport does. Do not send the backend's
   * `deviceId` back to the page.
   */
  activate(
    activationBlob: EnrollActivationResponse,
  ): Promise<RelayActivateResponse | void>;
}

export interface EnrollOptions {
  /** Overall timeout (ms) per native-host leg. Default 135000 — enroll includes a UAC prompt. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** What {@link enroll} resolves with. */
export interface EnrollResult {
  /**
   * This installation's wrapped attestation key. Keep it; pass it to every
   * `attest` and `mintKey`. It is a credential: any code that can read it
   * can attest as this installation.
   */
  ak: AkBlob;
}

// Enrollment can block on a user-facing UAC prompt, so each native-host leg gets
// a generous default: above the extension's own 125 s host timeout, so a slow
// leg is reported by the extension rather than by this timer firing first.
const DEFAULT_TIMEOUT_MS = 135_000;

/**
 * Enroll this installation with RootHerald via the embedder-relayed handshake.
 *
 * Every call creates a new installation with a new AK blob; the device's
 * alias does not change. Resolves with the AK blob and nothing else: the page
 * learns nothing about the device it enrolled.
 *
 * @param relay  Embedder callbacks that bridge the two network legs to the
 *               embedder's backend (which holds `rh_sk_`). The browser never
 *               POSTs to RootHerald itself.
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored (incl. a declined UAC)
 *   - {@link AbiMismatchError} if the host reports an ABI major other than
 *     this SDK's, checked before anything is relayed
 *   - {@link TimeoutError} if a leg started but did not complete in time
 *   - whatever `relay.enroll` / `relay.activate` reject with (backend errors)
 */
export async function enroll(
  relay: EnrollRelay,
  opts: EnrollOptions = {},
): Promise<EnrollResult> {
  if (!relay || typeof relay.enroll !== 'function' || typeof relay.activate !== 'function') {
    throw new TypeError(
      'enroll: `relay` must provide `enroll` and `activate` callbacks that bridge to your backend',
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const win = opts.win;

  // ── Leg 1: host EnrollBegin -> enroll request blob + AK blob ───────────────
  const beginRes = await sendRequest(
    { action: ACTION_ENROLL_BEGIN },
    { timeoutMs, win },
  );
  if (beginRes === TIMED_OUT || beginRes.success !== true) {
    throw await failureOf(beginRes, 'beginning enrollment', win);
  }
  requireHostAbi(beginRes.data, { required: true });
  const enrollBody = beginRes.data?.enrollBody as
    | EnrollRequestBlob
    | undefined;
  if (!enrollBody) {
    throw new HostMissingError(
      'Extension reported success but returned no enrollBody',
    );
  }
  const ak = beginRes.data?.akBlob;
  if (typeof ak !== 'string' || ak.length === 0) {
    throw new HostMissingError('Extension reported success but returned no akBlob');
  }

  // ── Relay leg 1: embedder POSTs the blob to its backend (rh_sk_) ───────────
  const relayResult = await relay.enroll(enrollBody);

  // ── Leg 2: host EnrollComplete(challenge, akBlob) -> activation blob ───────
  const completeRes = await sendRequest(
    { action: ACTION_ENROLL_COMPLETE, challenge: relayResult.challenge, akBlob: ak },
    { timeoutMs, win },
  );
  if (completeRes === TIMED_OUT || completeRes.success !== true) {
    throw await failureOf(completeRes, 'completing enrollment', win);
  }
  requireHostAbi(completeRes.data, { required: false });
  const activationBlob = completeRes.data?.activationBlob as
    | EnrollActivationResponse
    | undefined;
  if (!activationBlob) {
    throw new HostMissingError(
      'Extension reported success but returned no activationBlob',
    );
  }

  // ── Relay leg 2: embedder POSTs the activation blob to its backend ─────────
  await relay.activate(activationBlob);
  return { ak };
}
