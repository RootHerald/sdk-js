/**
 * Device enrollment — the page-side TPM steps of the first-time enroll ceremony.
 *
 * A first-time device must ENROLL before Background-Check `/verify` works.
 * Enrollment is a 2-round-trip ceremony with a TPM op between:
 *   1. `enrollCollect()` asks the extension/host to produce an `enrollRequest`;
 *      the PAGE relays it to the customer proxy's POST /api/v1/devices/enroll.
 *      The server returns a MakeCredential `challenge`.
 *   2. `enrollActivate(challenge)` asks the extension/host to activate that
 *      challenge and produce an `activateRequest`; the PAGE relays it to the
 *      customer proxy's POST /api/v1/devices/activate.
 *
 * Like {@link collectEvidence}, these wrap the extension TPM steps ONLY — they
 * are keyless and make NO RootHerald network contact. The page forwards the
 * opaque blobs verbatim to the customer's server, which relays them server-to-
 * server with its `rh_sk_` secret.
 */

import { ACTION_ENROLL_ACTIVATE, ACTION_ENROLL_COLLECT } from './constants.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from './errors.js';
import { sendRequest, type MessageWindow } from './transport.js';

/**
 * Opaque body for POST /api/v1/devices/enroll, produced by the native host.
 * The page forwards it verbatim to the customer proxy — never inspect it here.
 */
export type EnrollRequest = unknown;

/**
 * Opaque body for POST /api/v1/devices/activate, produced by the native host.
 * The page forwards it verbatim to the customer proxy — never inspect it here.
 */
export type ActivateRequest = unknown;

export interface EnrollOptions {
  /** Overall timeout (ms). Default 30000 — a TPM op can be slow. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Classify an extension/host failure into one of the typed errors, mirroring
 * exactly the classification {@link collectEvidence} uses. A fully-silent
 * extension (`res === null`) cannot be distinguished from a missing one, so it
 * maps to {@link ExtensionMissingError}.
 */
function classifyFailure(error: string | undefined, fallback: string): never {
  const errText = String(error ?? '').toLowerCase();
  if (
    errText.includes('native host') ||
    errText.includes('disconnect') ||
    errText.includes('connectnative')
  ) {
    throw new HostMissingError(error ?? 'RootHerald native host not reachable');
  }
  if (errText.includes('timed out') || errText.includes('timeout')) {
    throw new TimeoutError(error ?? 'Enrollment step timed out');
  }
  // Unknown failure with the extension present but no result: treat as a host
  // problem (the most actionable cold-start fix).
  throw new HostMissingError(error ?? fallback);
}

/**
 * Round 1 of enrollment. Returns the opaque `enrollRequest` blob for the page
 * to relay to POST /api/v1/devices/enroll. NO RootHerald network contact.
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link TimeoutError} if the step started but did not complete in time
 */
export async function enrollCollect(opts: EnrollOptions = {}): Promise<EnrollRequest> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_ENROLL_COLLECT },
    { timeoutMs, win: opts.win },
  );

  if (res === null) {
    throw new ExtensionMissingError(
      'No response from the RootHerald extension while collecting the enroll request',
    );
  }

  if (res.success === true) {
    const enrollRequest = res.data?.enrollRequest;
    if (enrollRequest === undefined) {
      throw new HostMissingError(
        'Extension reported success but returned no enroll request',
      );
    }
    return enrollRequest as EnrollRequest;
  }

  classifyFailure(res.error, 'Enroll collect failed');
}

/**
 * Round 2 of enrollment. Given the server's MakeCredential `challenge` (the
 * blob the server returned from /enroll), returns the opaque `activateRequest`
 * blob for the page to relay to POST /api/v1/devices/activate. NO RootHerald
 * network contact. Same error handling as {@link enrollCollect}.
 */
export async function enrollActivate(
  challenge: unknown,
  opts: EnrollOptions = {},
): Promise<ActivateRequest> {
  if (challenge === undefined || challenge === null) {
    throw new TypeError('enrollActivate: `challenge` must be the server MakeCredential blob');
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_ENROLL_ACTIVATE, challenge },
    { timeoutMs, win: opts.win },
  );

  if (res === null) {
    throw new ExtensionMissingError(
      'No response from the RootHerald extension while activating the enroll challenge',
    );
  }

  if (res.success === true) {
    const activateRequest = res.data?.activateRequest;
    if (activateRequest === undefined) {
      throw new HostMissingError(
        'Extension reported success but returned no activate request',
      );
    }
    return activateRequest as ActivateRequest;
  }

  classifyFailure(res.error, 'Enroll activate failed');
}
