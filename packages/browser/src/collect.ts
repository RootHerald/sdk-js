/**
 * attest — the page-side per-attestation verb (host CollectEvidence).
 *
 * Keyless and offline w.r.t. RootHerald: this posts a `collect` request to the
 * extension (which drives the native host to take a fresh TPM quote over the
 * backend-issued `nonce`) and returns the opaque evidence blob. The PAGE hands
 * that blob to the EMBEDDER's backend. The `rh_sk_` secret and the appraisal
 * that turns the blob into a verdict live ONLY on that backend (a server SDK
 * such as @rootherald/node) — never in this browser package. No `rh_sk_` secret,
 * no verdict, and no RootHerald network contact ever touch the page.
 */

import type { EvidenceBlob } from '@rootherald/contracts';
import { ACTION_COLLECT } from './constants.js';
import {
  ExtensionMissingError,
  HostMissingError,
  NotEnrolledError,
  TimeoutError,
} from './errors.js';
import { sendRequest, type MessageWindow } from './transport.js';

/**
 * The embedder's bridge to its OWN backend for the verify leg. POST the evidence
 * blob to your backend, which calls @rootherald/node `verify(evidence, …)` (with
 * its `rh_sk_` secret) and returns whatever your endpoint chooses to expose
 * (a verdict, a session token, a boolean…). The browser never sees a verdict.
 */
export interface AttestRelay<R = unknown> {
  verify(evidence: EvidenceBlob): Promise<R>;
}

export interface AttestOptions {
  /** Correlation id from the customer's `/challenge` response; echoed back. */
  challengeId?: string;
  /** Overall timeout (ms). Default 30000 — a TPM quote can be slow. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** {@link AttestOptions} plus an embedder relay; makes {@link attest} return the relay result. */
export interface AttestWithRelayOptions<R> extends AttestOptions {
  /**
   * Optional bridge to your backend's verify leg. When provided, the collected
   * evidence is handed to `relay.verify` and {@link attest} resolves with its
   * result instead of the raw blob — a one-call convenience for embedders that
   * relay immediately.
   */
  relay: AttestRelay<R>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Collect a fresh device-evidence blob over `nonce` (the per-attestation verb).
 *
 * Without a `relay`, resolves with the opaque {@link EvidenceBlob} for the page
 * to hand to its backend. With a `relay`, hands the blob to `relay.verify` and
 * resolves with that result. Keyless either way.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link TimeoutError} if collection started but did not complete in time
 *   - whatever `relay.verify` rejects with (backend errors), when a relay is given
 */
export function attest(nonce: string, opts?: AttestOptions): Promise<EvidenceBlob>;
export function attest<R>(
  nonce: string,
  opts: AttestWithRelayOptions<R>,
): Promise<R>;
export async function attest<R>(
  nonce: string,
  opts: AttestOptions | AttestWithRelayOptions<R> = {},
): Promise<EvidenceBlob | R> {
  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new TypeError('attest: `nonce` must be a non-empty string');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    {
      action: ACTION_COLLECT,
      nonce,
      ...(opts.challengeId !== undefined ? { challengeId: opts.challengeId } : {}),
    },
    { timeoutMs, win: opts.win },
  );

  // No response at all within the window: the extension isn't there to relay.
  if (res === null) {
    throw new ExtensionMissingError(
      'No response from the RootHerald extension while collecting evidence',
    );
  }

  let evidence: EvidenceBlob;
  if (res.success === true) {
    const blob = res.data?.evidence;
    if (blob === undefined) {
      throw new HostMissingError(
        'Extension reported success but returned no evidence blob',
      );
    }
    evidence = blob as EvidenceBlob;
  } else {
    // Extension answered but failed: classify by the host error it surfaced.
    const errText = String(res.error ?? '').toLowerCase();
    // Device has no attestation key yet — the "attest-first, enroll-on-miss"
    // signal. Distinct from a missing host so callers can run enroll() + retry.
    if (errText.includes('not enrolled')) {
      throw new NotEnrolledError(res.error ?? 'Device is not enrolled — run enroll() first');
    }
    if (
      errText.includes('native host') ||
      errText.includes('disconnect') ||
      errText.includes('connectnative')
    ) {
      throw new HostMissingError(res.error ?? 'RootHerald native host not reachable');
    }
    if (errText.includes('timed out') || errText.includes('timeout')) {
      throw new TimeoutError(res.error ?? 'Evidence collection timed out');
    }
    // Unknown failure with the extension present but no host evidence: treat as
    // a host problem (the most actionable cold-start fix).
    throw new HostMissingError(res.error ?? 'Evidence collection failed');
  }

  if ('relay' in opts && opts.relay) {
    return opts.relay.verify(evidence);
  }
  return evidence;
}

/**
 * @deprecated Renamed to {@link attest} for the Client ABI 3.0 contract. Thin
 * alias retained for backwards compatibility; resolves with the evidence blob.
 */
export function collectEvidence(
  nonce: string,
  opts: AttestOptions = {},
): Promise<EvidenceBlob> {
  return attest(nonce, opts);
}

/** @deprecated Use {@link AttestOptions}. */
export type CollectOptions = AttestOptions;
