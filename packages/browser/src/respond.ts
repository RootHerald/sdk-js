/**
 * respond — the page-side per-challenge verb (host `Respond`).
 *
 * Keyless and offline w.r.t. RootHerald: this posts a `respond` request to the
 * extension, which drives the native host to do what the challenge's ask says
 * (fresh TPM quote, event log, key certification) and returns the opaque
 * evidence blob. The PAGE hands that blob to the EMBEDDER's backend. The
 * `rh_sk_` secret and the appraisal that turns the blob into a verdict live
 * ONLY on that backend (a server SDK such as @rootherald/node) — never in this
 * browser package. No `rh_sk_` secret, no verdict, and no RootHerald network
 * contact ever touch the page.
 */

import type { EvidenceBlob, KeyBlob } from '@rootherald/contracts';
import { ACTION_RESPOND } from './constants.js';
import { HostMissingError } from './errors.js';
import { failureOf } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

/**
 * The embedder's bridge to its OWN backend for the verify leg. POST the evidence
 * blob to your backend, which calls @rootherald/node `verify(evidence, …)` (with
 * its `rh_sk_` secret) and returns whatever your endpoint chooses to expose
 * (a verdict, a session token, a boolean…). The browser never sees a verdict.
 *
 * When the ask included `"key"`, the `KeyBlob` the page must keep is passed as
 * the second argument, so a relay that resolves the whole flow in one call can
 * store it.
 */
export interface RespondRelay<R = unknown> {
  verify(evidence: EvidenceBlob, key?: KeyBlob): Promise<R>;
}

export interface RespondOptions {
  /**
   * A `KeyBlob` from an earlier `"key"` ask, to certify again under this
   * challenge instead of creating a fresh key. Omit to create a new key when
   * the ask includes `"key"`; ignored when it does not.
   */
  key?: KeyBlob;
  /** Overall timeout (ms). Default 75000 — a quote plus a key certification can be slow. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/** {@link RespondOptions} plus an embedder relay; makes {@link respond} return the relay result. */
export interface RespondWithRelayOptions<R> extends RespondOptions {
  /**
   * Bridge to your backend's verify leg. When provided, the evidence is handed
   * to `relay.verify` and {@link respond} resolves with its result instead of
   * the evidence — a one-call convenience for embedders that relay immediately.
   */
  relay: RespondRelay<R>;
}

/** What {@link respond} resolves with when no relay is given. */
export interface RespondResult {
  /** The opaque evidence blob for the backend's verify leg. */
  evidence: EvidenceBlob;
  /**
   * The wrapped signing key, present when the challenge's ask included
   * `"key"`. Store it; it is the only handle to the key and no SDK parses it.
   * Sign with it later via {@link import('./sign.js').sign}.
   */
  key?: KeyBlob;
}

// Above the extension's own 60 s host timeout, so a slow host is reported by
// the extension's "timed out" rather than by this timer firing first.
const DEFAULT_TIMEOUT_MS = 75_000;
const CHALLENGE_PREFIX = 'rhc1.';

/**
 * Respond to a backend-issued challenge (the per-attestation verb).
 *
 * `challenge` is the `rhc1.` string from the backend's `issueChallenge`,
 * relayed verbatim. The host parses it for the nonce and the ask; the page
 * does not need to.
 *
 * Without a `relay`, resolves with `{ evidence, key? }` for the page to hand to
 * its backend. With a `relay`, hands the evidence (and key) to `relay.verify`
 * and resolves with that result. Keyless either way.
 *
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link NotEnrolledError} if the device has no attestation key yet — run
 *     `enroll()` and retry
 *   - {@link AskUnsupportedError} if the ask names something this host cannot do
 *   - {@link KeyUnloadableError} if `opts.key` could not be loaded
 *   - {@link AbiMismatchError} if the host is a different version than this SDK
 *   - {@link TimeoutError} if the host started but did not finish in time
 *   - whatever `relay.verify` rejects with (backend errors), when a relay is given
 */
export function respond(challenge: string, opts?: RespondOptions): Promise<RespondResult>;
export function respond<R>(
  challenge: string,
  opts: RespondWithRelayOptions<R>,
): Promise<R>;
export async function respond<R>(
  challenge: string,
  opts: RespondOptions | RespondWithRelayOptions<R> = {},
): Promise<RespondResult | R> {
  if (typeof challenge !== 'string' || !challenge.startsWith(CHALLENGE_PREFIX)) {
    throw new TypeError(
      'respond: `challenge` must be the `rhc1.` string from the backend, relayed verbatim',
    );
  }
  if (opts.key !== undefined && (typeof opts.key !== 'string' || opts.key.length === 0)) {
    throw new TypeError('respond: `key` must be the KeyBlob string from an earlier respond()');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    {
      action: ACTION_RESPOND,
      challenge,
      ...(opts.key !== undefined ? { keyBlob: opts.key } : {}),
    },
    { timeoutMs, win: opts.win },
  );

  if (res === TIMED_OUT || res.success !== true) {
    throw await failureOf(res, 'responding to the challenge', opts.win);
  }

  const evidence = res.data?.evidence;
  if (evidence === undefined) {
    throw new HostMissingError('Extension reported success but returned no evidence blob');
  }
  const key = res.data?.keyBlob;
  if (key !== undefined && (typeof key !== 'string' || key.length === 0)) {
    throw new HostMissingError('Extension returned a key blob that is not a string');
  }

  if ('relay' in opts && opts.relay) {
    return opts.relay.verify(evidence, key);
  }
  const result: RespondResult = { evidence };
  if (key !== undefined) result.key = key;
  return result;
}
