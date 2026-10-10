/**
 * attest — the page-side per-challenge verb (host `Attest`).
 *
 * Keyless and offline w.r.t. RootHerald: this posts an `attest` request to the
 * extension, which drives the native host to quote what the challenge's ask
 * says under the installation's AK and returns the opaque evidence blob. The
 * PAGE hands that blob to the EMBEDDER's backend. The `rh_sk_` secret and the
 * appraisal that turns the blob into a verdict live ONLY on that backend (a
 * server SDK such as @rootherald/node) — never in this browser package.
 */

import type { AkBlob, EvidenceBlob } from '@rootherald/contracts';
import { ACTION_ATTEST } from './constants.js';
import { HostMissingError } from './errors.js';
import { failureOf, requireHostAbi } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

/**
 * The embedder's bridge to its OWN backend for the verify leg. POST the evidence
 * blob to your backend, which calls @rootherald/node `verify(evidence, …)` (with
 * its `rh_sk_` secret) and returns whatever your endpoint chooses to expose
 * (a session token, a boolean…). The browser never sees a verdict.
 */
export interface AttestRelay<R = unknown> {
  verify(evidence: EvidenceBlob): Promise<R>;
}

export interface AttestOptions {
  /** This installation's AK blob, from `enroll()`. */
  ak: AkBlob;
  /** Overall timeout (ms). Default 75000 — a quote with an event log can be slow. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** {@link AttestOptions} plus an embedder relay; makes {@link attest} return the relay result. */
export interface AttestWithRelayOptions<R> extends AttestOptions {
  /**
   * Bridge to your backend's verify leg. When provided, the evidence is handed
   * to `relay.verify` and {@link attest} resolves with its result instead of
   * the evidence — a one-call convenience for embedders that relay immediately.
   */
  relay: AttestRelay<R>;
}

/** What {@link attest} resolves with when no relay is given. */
export interface AttestResult {
  /** The opaque evidence blob for the backend's verify leg. */
  evidence: EvidenceBlob;
}

// Above the extension's own 60 s host timeout, so a slow host is reported by
// the extension's "timed out" rather than by this timer firing first.
const DEFAULT_TIMEOUT_MS = 75_000;
const CHALLENGE_PREFIX = 'rhc1.';

/**
 * Answer a backend-issued challenge (the per-attestation verb).
 *
 * `challenge` is the `rhc1.` string from the backend's `issueChallenge`,
 * relayed verbatim. The host parses it for the nonce and the ask; the page
 * does not need to. `ak` is the AK blob `enroll()` returned.
 *
 * Without a `relay`, resolves with `{ evidence }` for the page to hand to
 * its backend. With a `relay`, hands the evidence to `relay.verify` and
 * resolves with that result. Keyless either way.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link KeyUnloadableError} if `ak` will not load into this TPM — discard
 *     it, `enroll()`, retry once
 *   - {@link AskUnsupportedError} if the ask names something this host cannot do
 *   - {@link AbiMismatchError} if the host is a different version than this SDK
 *   - {@link TimeoutError} if the host started but did not finish in time
 *   - whatever `relay.verify` rejects with (backend errors), when a relay is given
 */
export function attest(challenge: string, opts: AttestOptions): Promise<AttestResult>;
export function attest<R>(
  challenge: string,
  opts: AttestWithRelayOptions<R>,
): Promise<R>;
export async function attest<R>(
  challenge: string,
  opts: AttestOptions | AttestWithRelayOptions<R>,
): Promise<AttestResult | R> {
  if (typeof challenge !== 'string' || !challenge.startsWith(CHALLENGE_PREFIX)) {
    throw new TypeError(
      'attest: `challenge` must be the `rhc1.` string from the backend, relayed verbatim',
    );
  }
  if (!opts || typeof opts.ak !== 'string' || opts.ak.length === 0) {
    throw new TypeError('attest: `ak` must be the AK blob string from enroll()');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_ATTEST, challenge, akBlob: opts.ak },
    { timeoutMs, win: opts.win },
  );

  if (res === TIMED_OUT || res.success !== true) {
    throw await failureOf(res, 'answering the challenge', opts.win);
  }
  requireHostAbi(res.data, { required: false });

  const evidence = res.data?.evidence;
  if (evidence === undefined) {
    throw new HostMissingError('Extension reported success but returned no evidence blob');
  }

  if ('relay' in opts && opts.relay) {
    return opts.relay.verify(evidence);
  }
  return { evidence };
}
