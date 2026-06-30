/**
 * Device enrollment — trigger the first-time enroll ceremony on the native host.
 *
 * A first-time device must ENROLL before Background-Check `/verify` works.
 * Enrollment is a single device↔RootHerald operation that runs entirely in the
 * native host under one elevation (the "Establish hardware key" UAC): the host
 * creates the AK, runs TPM2_ActivateCredential to bind it to the EK, and evicts
 * it to a persistent handle. Subsequent {@link collectEvidence} calls are
 * unprivileged.
 *
 * Unlike {@link collectEvidence}, enrollment reaches RootHerald directly from the
 * host. It is still KEYLESS from the page's perspective: the host registers the
 * device's endorsement key with no secret involved. The customer's `rh_sk_`
 * secret and the act of verification live ONLY on the customer's backend (a
 * server SDK such as @rootherald/node, on the server→server `/verify` path) —
 * never in this browser package. The page only triggers enrollment and reads
 * back the enrolled `deviceId`.
 */

import { ACTION_ENROLL } from './constants.js';
import { ExtensionMissingError, HostMissingError, TimeoutError } from './errors.js';
import { sendRequest } from './transport.js';
import type { MessageWindow } from './transport.js';

export interface EnrollOptions {
  /**
   * RootHerald endpoint the host enrolls against. Optional — when omitted the
   * host uses its configured default. Set this to point a local/staging client
   * at a non-production RootHerald (e.g. the /try demo at http://localhost:8080).
   */
  serverUrl?: string;
  /** Overall timeout (ms). Default 120000 — enrollment includes a UAC prompt. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

export interface EnrollResult {
  /** The enrolled device's stable id (the EAT `ueid`). */
  deviceId: string;
}

// Enrollment can block on a user-facing UAC prompt, so it gets a generous
// default well above the collect timeout.
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Enroll this device with RootHerald. Triggers the host's elevated enroll and
 * resolves with the enrolled `deviceId`. Idempotent — a returning device
 * re-enrolls harmlessly and resolves with the same id.
 * Throws:
 *   - {@link ExtensionMissingError} if the extension never responds
 *   - {@link HostMissingError} if the extension is present but the native host
 *     could not be reached / errored (incl. a declined UAC)
 *   - {@link TimeoutError} if the step started but did not complete in time
 */
export async function enroll(opts: EnrollOptions = {}): Promise<EnrollResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await sendRequest(
    { action: ACTION_ENROLL, serverUrl: opts.serverUrl },
    { timeoutMs, win: opts.win },
  );

  if (res === null) {
    throw new ExtensionMissingError(
      'No response from the RootHerald extension while enrolling the device',
    );
  }

  if (res.success === true) {
    const deviceId = res.data?.deviceId;
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      throw new HostMissingError(
        'Extension reported success but returned no deviceId',
      );
    }
    return { deviceId };
  }

  // Classify the failure into one of the typed errors, mirroring collectEvidence.
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
