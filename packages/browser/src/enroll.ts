/**
 * Device enrollment — orchestrate the keyless, backend-relayed enroll handshake.
 *
 * A first-time device must ENROLL before {@link import('./collect.js').attest}
 * works. Enrollment is a two-leg credential-activation handshake; the local TPM
 * halves run on the native host under a SINGLE elevation (one "Establish
 * hardware key" UAC) via raw-TBS — `EnrollBegin` (gen AK, gather EK) then
 * `EnrollComplete` (`TPM2_ActivateCredential`) in the SAME resident elevated
 * worker.
 *
 * KEYLESS: the page holds no RootHerald key and never talks to RootHerald. The
 * two network legs are RELAYED by the embedder's backend. This SDK calls back
 * into embedder-provided `relay.enroll` / `relay.activate`, which POST the opaque
 * blobs to the embedder's OWN backend; that backend uses @rootherald/node's
 * `relayEnroll` / `relayActivate` (with its `rh_sk_` secret) to reach RootHerald.
 * The browser only moves blobs across the page<->extension<->host bridge.
 *
 * Flow:
 *   1. `enroll-begin` {}            -> { enrollRequestBlob }   (host EnrollBegin)
 *   2. relay.enroll(enrollRequestBlob) -> RelayEnrollResult { deviceId, challenge }
 *   3. `enroll-complete` { challenge } -> { activationBlob }   (host EnrollComplete)
 *   4. relay.activate(activationBlob)  -> done (deviceId)
 */

import type {
  EnrollRequestBlob,
  EnrollActivationResponse,
} from '@rootherald/contracts';
import type {
  RelayEnrollResult,
  RelayActivateResponse,
} from '@rootherald/contracts/server';
import { ACTION_ENROLL_BEGIN, ACTION_ENROLL_COMPLETE } from './constants.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from './errors.js';
import { sendRequest, type MessageWindow } from './transport.js';

/**
 * The embedder's bridge to its OWN backend. These callbacks are how the keyless
 * browser SDK reaches RootHerald without holding a key: each one POSTs an opaque
 * blob to the embedder's backend, which relays it to RootHerald with `rh_sk_`
 * (via @rootherald/node) and returns the result.
 */
export interface EnrollRelay {
  /**
   * Relay leg 1. POST `enrollRequestBlob` to your backend, which calls
   * @rootherald/node `relayEnroll(blob)` and returns its {@link RelayEnrollResult}
   * (the normalized 201-fresh / 409-already-enrolled outcome).
   */
  enroll(enrollRequestBlob: EnrollRequestBlob): Promise<RelayEnrollResult>;
  /**
   * Relay leg 2. POST the `activationBlob` to your backend, which calls
   * @rootherald/node `relayActivate(blob)`. Only invoked on the fresh-enroll
   * branch. The return value is ignored; resolve
   * however your transport does.
   */
  activate(
    activationBlob: EnrollActivationResponse,
  ): Promise<RelayActivateResponse | void>;
}

export interface EnrollOptions {
  /** Overall timeout (ms) per native-host leg. Default 120000 — enroll includes a UAC prompt. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

export interface EnrollResult {
  /**
   * Internal enrolment handle for the device.
   *
   * NOT the EAT `ueid`, and not equal to it. The `ueid` a verdict returns is
   * scoped to the calling tenant, so it differs from this value (and differs
   * between tenants for the same machine). Key your own tables on
   * `verdict.device.ueid`, not on this.
   */
  deviceId: string;
}

// Enrollment can block on a user-facing UAC prompt, so each native-host leg gets
// a generous default well above the collect timeout.
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Enroll this device with RootHerald via the embedder-relayed handshake.
 *
 * Idempotent — a device that has enrolled before runs the same two legs again
 * and resolves with the same `deviceId`. Re-enrolment is also how a device
 * rotates its attestation key, so it is never short-circuited.
 *
 * @param relay  Embedder callbacks that bridge the two network legs to the
 *               embedder's backend (which holds `rh_sk_`). The browser never
 *               POSTs to RootHerald itself.
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored (incl. a declined UAC)
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

  // ── Leg 1: host EnrollBegin -> opaque enroll request blob ──────────────────
  const beginRes = await sendRequest(
    { action: ACTION_ENROLL_BEGIN },
    { timeoutMs, win },
  );
  classifyTransportFailure(beginRes, 'beginning enrollment');
  const enrollRequestBlob = beginRes!.data?.enrollRequestBlob as
    | EnrollRequestBlob
    | undefined;
  if (!enrollRequestBlob) {
    throw new HostMissingError(
      'Extension reported success but returned no enrollRequestBlob',
    );
  }

  // ── Relay leg 1: embedder POSTs the blob to its backend (rh_sk_) ───────────
  const relayResult = await relay.enroll(enrollRequestBlob);

  // ── Leg 2: host EnrollComplete(challenge) -> opaque activation blob ────────
  const completeRes = await sendRequest(
    { action: ACTION_ENROLL_COMPLETE, challenge: relayResult.challenge },
    { timeoutMs, win },
  );
  classifyTransportFailure(completeRes, 'completing enrollment');
  const activationBlob = completeRes!.data?.activationBlob as
    | EnrollActivationResponse
    | undefined;
  if (!activationBlob) {
    throw new HostMissingError(
      'Extension reported success but returned no activationBlob',
    );
  }

  // ── Relay leg 2: embedder POSTs the activation blob to its backend ─────────
  await relay.activate(activationBlob);

  // deviceId is known after leg 1 (carried on the challenge / relay result).
  return { deviceId: relayResult.deviceId };
}

/**
 * Turn a native-host leg's transport outcome into a typed error. Throws when the
 * response is missing or unsuccessful; returns cleanly when the host reported
 * success (data shape is validated by the caller). Mirrors the collect classifier.
 */
function classifyTransportFailure(
  res: { success?: boolean; error?: string } | null,
  doing: string,
): void {
  if (res === null) {
    throw new ExtensionMissingError(
      `No response from the RootHerald extension while ${doing}`,
    );
  }
  if (res.success === true) return;

  const errText = String(res.error ?? '').toLowerCase();
  if (
    errText.includes('native host') ||
    errText.includes('disconnect') ||
    errText.includes('connectnative')
  ) {
    throw new HostMissingError(res.error ?? 'RootHerald native host not reachable');
  }
  if (errText.includes('timed out') || errText.includes('timeout')) {
    throw new TimeoutError(res.error ?? 'Enrollment timed out');
  }
  // Extension present but no result: treat as a host problem (most actionable).
  throw new HostMissingError(res.error ?? 'Enrollment failed');
}
