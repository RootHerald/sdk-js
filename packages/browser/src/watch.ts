/**
 * onClientStatusChange — live cold-start detection for install steppers.
 *
 * Polls `getClientStatus()` on an interval and invokes the callback whenever
 * the resolved status changes (and once immediately with the first reading),
 * so a UI can auto-advance: extension appears -> host appears -> READY.
 */

import { getClientStatus, type ClientStatus, type DetectOptions } from './detect.js';

export interface WatchOptions extends DetectOptions {
  /** Poll interval (ms). Default 1500 — the "listening…" cadence. */
  intervalMs?: number;
  /**
   * Emit the first reading immediately (default true). When false, the
   * callback only fires on subsequent changes.
   */
  emitInitial?: boolean;
}

/** Stop a watcher started by {@link onClientStatusChange}. */
export type Unsubscribe = () => void;

const DEFAULT_INTERVAL_MS = 1500;

function statusEqual(a: ClientStatus, b: ClientStatus): boolean {
  return (
    a.os === b.os &&
    a.browser === b.browser &&
    a.extension === b.extension &&
    a.host === b.host
  );
}

export function onClientStatusChange(
  callback: (status: ClientStatus) => void,
  opts: WatchOptions = {},
): Unsubscribe {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const emitInitial = opts.emitInitial ?? true;
  let last: ClientStatus | null = null;
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const status = await getClientStatus(opts);
      if (stopped) return;
      const isFirst = last === null;
      if ((isFirst && emitInitial) || (last !== null && !statusEqual(last, status))) {
        last = status;
        callback(status);
      } else {
        last = status;
      }
    } finally {
      inFlight = false;
    }
  };

  // Kick off an immediate reading, then poll.
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
