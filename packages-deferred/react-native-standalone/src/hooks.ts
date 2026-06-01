/**
 * React hooks for Root Herald.
 *
 * Two hooks are exported:
 *   - useVerifyDevice — fires a single verify() per call site and exposes
 *     loading/error/result state plus a manual trigger.
 *   - useDevicePosture — derives the most recent posture/tpmClass from a
 *     verify result, returning a flat structure suitable for direct UI
 *     binding without consumers needing to parse the JSON posture blob.
 *
 * Both hooks tolerate unmount-mid-flight: in-flight verify promises resolve
 * but state updates are dropped once the component is gone. The verify
 * function additionally aborts via an AbortController so consumers can wire
 * up cancel-on-unmount semantics through the optional `signal` parameter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RootHeraldClient } from './client.js';
import type {
  RootHeraldOptions,
  UseVerifyDeviceOptions,
  UseVerifyDeviceResult,
  VerifyResult,
} from './types.js';

/**
 * Lightweight per-app singleton helper. Most apps want one client. If you
 * need multiple (e.g. multi-tenant), construct {@link RootHeraldClient}s
 * directly and pass them via the hook's `client` option.
 */
let _singleton: RootHeraldClient | null = null;
let _singletonKey: string | null = null;

export function getOrCreateSharedClient(options: RootHeraldOptions): RootHeraldClient {
  const key = `${options.apiKey}|${options.endpoint ?? ''}|${options.applicationId ?? ''}|${
    options.mockTpm ? '1' : '0'
  }`;
  if (_singleton && _singletonKey === key) return _singleton;
  _singleton = new RootHeraldClient(options);
  _singletonKey = key;
  return _singleton;
}

/** @internal — exposed for tests to reset the module-level singleton. */
export function _resetSharedClientForTesting(): void {
  _singleton = null;
  _singletonKey = null;
}

/**
 * Hook for performing a device verification.
 *
 * Behaviour:
 *   - On mount, if `autoStart` is true, calls verify() once.
 *   - Provides a stable `verify` callback for explicit triggering.
 *   - Cancels any in-flight call on unmount.
 *   - Coalesces overlapping calls — only the latest result wins.
 */
export function useVerifyDevice(options: UseVerifyDeviceOptions): UseVerifyDeviceResult {
  const { action, autoStart = false, client } = options;

  if (!client) {
    throw new Error(
      '[@rootherald/react-native] useVerifyDevice requires a `client` option. ' +
        'Construct one via `new RootHeraldClient({ apiKey })` or `getOrCreateSharedClient({ apiKey })`.',
    );
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const mountedRef = useRef(true);
  const callIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const verify = useCallback(async (): Promise<VerifyResult | null> => {
    // Cancel any in-flight call before starting a new one.
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const myCallId = ++callIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const r = await client.verify(action, { signal: ac.signal });
      if (!mountedRef.current || callIdRef.current !== myCallId) return null;
      setResult(r);
      setLoading(false);
      return r;
    } catch (err) {
      if (!mountedRef.current || callIdRef.current !== myCallId) return null;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setLoading(false);
      return null;
    }
  }, [client, action]);

  // Auto-start once on mount when requested. We intentionally do NOT re-fire
  // when `verify` identity changes (that's just the memoized callback) — the
  // dependency on `autoStart` is what gates a one-shot.
  useEffect(() => {
    if (autoStart) {
      void verify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const reset = useCallback(() => {
    if (!mountedRef.current) return;
    setError(null);
    setResult(null);
    setLoading(false);
  }, []);

  return { verify, loading, error, result, reset };
}

/**
 * Convenience hook that surfaces a device's posture as a flat object.
 * Parses {@link VerifyResult.posture} JSON once and memoizes the result.
 */
export function useDevicePosture(result: VerifyResult | null): {
  tpmClass: string;
  posture: Record<string, unknown>;
  parseError: Error | null;
} | null {
  return useMemo(() => {
    if (!result) return null;
    let posture: Record<string, unknown> = {};
    let parseError: Error | null = null;
    try {
      posture = result.posture ? (JSON.parse(result.posture) as Record<string, unknown>) : {};
    } catch (e) {
      parseError = e instanceof Error ? e : new Error(String(e));
    }
    return { tpmClass: result.tpmClass, posture, parseError };
  }, [result]);
}
