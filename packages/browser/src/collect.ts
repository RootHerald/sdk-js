/**
 * collectEvidence — the page-side half of the Background-Check flow.
 *
 * Keyless and offline w.r.t. RootHerald: this posts a `collect` request to the
 * extension (which drives the native host to take a fresh TPM quote over the
 * server-issued `nonce`) and returns the opaque evidence blob. The PAGE hands
 * that blob to the CUSTOMER's server. The `rh_sk_` secret and the appraisal
 * that turns the blob into a verdict live ONLY on that backend (a server SDK
 * such as @rootherald/node) — never in this browser package. No `rh_sk_` secret
 * and no RootHerald network contact ever touch the page.
 */

import type { EvidenceBlob } from '@rootherald/contracts';
import { ACTION_COLLECT } from './constants.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from './errors.js';
import { sendRequest, type MessageWindow } from './transport.js';

export interface CollectOptions {
  /** Correlation id from the customer's `/challenge` response; echoed back. */
  challengeId?: string;
  /** Overall timeout (ms). Default 30000 — a TPM quote can be slow. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
  /**
   * Timeout (ms) for the pre-flight extension presence probe. Default 1500.
   * Distinguishes "no extension" from "extension present but host slow/missing".
   */
  pingTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Collect a device-evidence blob over `nonce`. Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored
 *   - {@link TimeoutError} if collection started but did not complete in time
 */
export async function collectEvidence(
  nonce: string,
  opts: CollectOptions = {},
): Promise<EvidenceBlob> {
  if (typeof nonce !== 'string' || nonce.length === 0) {
    throw new TypeError('collectEvidence: `nonce` must be a non-empty string');
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

  if (res.success === true) {
    const evidence = res.data?.evidence;
    if (evidence === undefined) {
      throw new HostMissingError(
        'Extension reported success but returned no evidence blob',
      );
    }
    return evidence as EvidenceBlob;
  }

  // Extension answered but failed: classify by the host error it surfaced.
  const errText = String(res.error ?? '').toLowerCase();
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
