/**
 * JS-side wrapper around the native Root Herald bridge.
 *
 * Behaves like a thin, promise-returning facade: each instance is backed by
 * exactly one native client (identified by an opaque handle obtained at
 * construction time). The native handle is resolved lazily on first use so
 * that `new RootHeraldClient(...)` is synchronous and never throws.
 */

import { getNativeModule, type NativeRootHeraldSpec } from './native/NativeRootHerald.js';
import { RootHeraldError, type RootHeraldOptions, type VerifyResult } from './types.js';

const DEFAULT_ENDPOINT = 'https://rootherald.io';

export class RootHeraldClient {
  private readonly options: Required<Pick<RootHeraldOptions, 'apiKey' | 'endpoint'>> &
    Omit<RootHeraldOptions, 'apiKey' | 'endpoint'>;

  /**
   * The native client handle. `null` until the first call to `ensureHandle()`.
   * Exposed only to tests via {@link _getHandleForTesting}.
   */
  private _handle: string | null = null;

  /** Promise that, once resolved, yields the native module. Cached for reuse. */
  private _nativePromise: Promise<NativeRootHeraldSpec> | null = null;

  constructor(options: RootHeraldOptions) {
    if (!options || typeof options.apiKey !== 'string' || options.apiKey.length === 0) {
      throw new RootHeraldError('E_INVALID_API_KEY', 'apiKey is required');
    }
    this.options = {
      apiKey: options.apiKey,
      endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
      applicationId: options.applicationId,
      mockTpm: options.mockTpm,
    };
  }

  /** @internal — exposed for tests; do not use in app code. */
  _getHandleForTesting(): string | null {
    return this._handle;
  }

  private async ensureHandle(): Promise<{ native: NativeRootHeraldSpec; handle: string }> {
    if (!this._nativePromise) {
      this._nativePromise = Promise.resolve().then(() => getNativeModule());
    }
    const native = await this._nativePromise;
    if (this._handle === null) {
      this._handle = await native.create(this.options.apiKey, this.options.endpoint);
      if (this.options.applicationId && native.setApplicationId) {
        await native.setApplicationId(this._handle, this.options.applicationId);
      }
      if (this.options.mockTpm && native.setMockTpm) {
        await native.setMockTpm(this._handle, true);
      }
    }
    return { native, handle: this._handle };
  }

  /**
   * Runs an attestation for the given action. Resolves with the verdict;
   * rejects with a {@link RootHeraldError} on bridge/network failure.
   *
   * Note: cancellation is cooperative — passing an `AbortSignal` causes the
   * returned promise to reject promptly, but the native attestation work
   * may continue to completion (the result is simply discarded). This mirrors
   * the behavior of the underlying iOS actor and Android coroutine APIs,
   * neither of which expose mid-flight cancellation today.
   */
  async verify(action: string, opts?: { signal?: AbortSignal }): Promise<VerifyResult> {
    if (typeof action !== 'string' || action.length === 0) {
      throw new RootHeraldError('E_INVALID_ACTION', 'action must be a non-empty string');
    }
    if (opts?.signal?.aborted) {
      throw new RootHeraldError('E_ABORTED', 'Aborted before native call');
    }

    const { native, handle } = await this.ensureHandle();

    const nativePromise = native.verify(handle, action);

    // If a signal is provided, race the native call against an abort
    // sentinel so the caller gets a prompt rejection.
    if (opts?.signal) {
      const signal = opts.signal;
      return await new Promise<VerifyResult>((resolve, reject) => {
        const onAbort = () => reject(new RootHeraldError('E_ABORTED', 'verify aborted'));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort);
        nativePromise.then(
          (r) => {
            signal.removeEventListener('abort', onAbort);
            resolve(normalize(r));
          },
          (err) => {
            signal.removeEventListener('abort', onAbort);
            reject(wrapError(err));
          },
        );
      });
    }

    try {
      const r = await nativePromise;
      return normalize(r);
    } catch (err) {
      throw wrapError(err);
    }
  }

  /**
   * Releases the native handle. Optional — handles are cleaned up when the
   * JS instance is garbage-collected on supported platforms, but releasing
   * explicitly is helpful in long-running apps that create transient clients.
   */
  async destroy(): Promise<void> {
    if (this._handle === null || this._nativePromise === null) return;
    const native = await this._nativePromise;
    if (native.destroy) {
      try {
        await native.destroy(this._handle);
      } catch {
        // best-effort
      }
    }
    this._handle = null;
  }
}

function normalize(raw: {
  verdict: string;
  deviceId: string;
  tpmClass: string;
  posture: string;
  reason: string;
}): VerifyResult {
  const v = String(raw.verdict).toLowerCase();
  const verdict: VerifyResult['verdict'] =
    v === 'allow' || v === 'warn' || v === 'deny' ? v : 'deny';
  return {
    verdict,
    deviceId: raw.deviceId ?? '',
    tpmClass: raw.tpmClass ?? '',
    posture: raw.posture ?? '{}',
    reason: raw.reason ?? '',
  };
}

function wrapError(err: unknown): RootHeraldError {
  if (err instanceof RootHeraldError) return err;
  if (err && typeof err === 'object') {
    const code = (err as { code?: string }).code ?? 'E_BRIDGE';
    const message = (err as { message?: string }).message ?? 'native verify failed';
    return new RootHeraldError(code, message);
  }
  return new RootHeraldError('E_UNKNOWN', String(err));
}
