/**
 * getPosture — local posture signals (host `CollectPosture`; no network).
 *
 * Readiness SIGNALS, never a verdict: what the host can see about the machine
 * without a challenge (TPM present, which AK families it supports, Secure
 * Boot state, its own version and ABI). Use it to avoid spending a challenge
 * that will hard-fail. The signals are host-defined; the three this SDK names
 * are `abi`, `host` and `capabilities`. There is no "enrolled" signal: the
 * page knows it is enrolled by holding an AK blob.
 */

import { ACTION_POSTURE } from './constants.js';
import type { RootHeraldResponseData } from './constants.js';
import { failureOf, requireHostAbi } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

export interface PostureOptions {
  /** Overall timeout (ms). Default 45000. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/**
 * Host-defined posture signals; `abi`, `host` and `capabilities` are the
 * three this SDK names. Readiness only: nothing in it identifies the device
 * to the page.
 */
export type DevicePosture = RootHeraldResponseData;

// Above the extension's own 30 s host timeout for `posture`.
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Read the host's local posture signals.
 *
 * Throws {@link ExtensionMissingError} / {@link HostMissingError} /
 * {@link AbiMismatchError} / {@link TimeoutError} like the other verbs.
 */
export async function getPosture(opts: PostureOptions = {}): Promise<DevicePosture> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const res = await sendRequest(
    { action: ACTION_POSTURE },
    { timeoutMs, win: opts.win },
  );
  if (res === TIMED_OUT || res.success !== true) {
    throw await failureOf(res, 'reading posture', opts.win);
  }
  requireHostAbi(res.data, { required: false });
  return res.data ?? {};
}
