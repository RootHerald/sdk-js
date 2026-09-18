/**
 * getPosture — local posture signals (host `CollectPosture`; no network).
 *
 * Readiness SIGNALS, never a verdict: what the host can see about the machine
 * without a challenge (TPM present, enrolled, Secure Boot state, its own
 * version and ABI). Use it to avoid spending a challenge that will hard-fail,
 * or to show the user what the install stepper still needs. The signals are
 * host-defined; the two this SDK names are `abi` and `host`.
 */

import { ACTION_POSTURE } from './constants.js';
import type { RootHeraldResponseData } from './constants.js';
import { failureOf } from './host-error.js';
import { sendRequest, TIMED_OUT, type MessageWindow } from './transport.js';

export interface PostureOptions {
  /** Overall timeout (ms). Default 45000. */
  timeoutMs?: number;
  /** Window to broker through. Defaults to global `window`. */
  win?: MessageWindow;
}

/**
 * Host-defined posture signals; `abi` and `host` are the two this SDK names.
 * Readiness only: nothing in it identifies the device to the page.
 */
export type DevicePosture = RootHeraldResponseData;

// Above the extension's own 30 s host timeout for `posture`.
const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Read the host's local posture signals.
 *
 * Throws {@link ExtensionMissingError} / {@link HostMissingError} /
 * {@link AbiMismatchError} / {@link TimeoutError} like the other verbs; a
 * device that is merely not enrolled still answers.
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
  return res.data ?? {};
}
