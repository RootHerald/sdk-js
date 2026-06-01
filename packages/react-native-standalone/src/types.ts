/**
 * Public TypeScript types for @rootherald/react-native.
 *
 * The native bridge (iOS RootHeraldKit / Android RootHeraldClient) speaks
 * the same wire protocol as every other Root Herald client SDK and returns
 * a result whose shape is mirrored here. Verdicts are normalized to
 * lower-case strings on the way out of the native layer so JS callers can
 * compare them without thinking about enum casing.
 */

/** The decision returned by the verifier. */
export type Verdict = 'allow' | 'warn' | 'deny';

/** Configuration for constructing a {@link RootHeraldClient}. */
export interface RootHeraldOptions {
  /**
   * Publishable API key, e.g. `pub_xxx` or `rh_pk_live_xxx`.
   * Safe to embed in shipped app binaries — it carries no spend authority.
   */
  apiKey: string;

  /**
   * Base URL of the Root Herald endpoint. Defaults to the public SaaS at
   * `https://rootherald.io`. Set to your custom domain or proxy URL to use
   * a different transport mode — the wire protocol is identical.
   */
  endpoint?: string;

  /**
   * Optional application identifier (forwarded to the native SDK). Useful
   * when a single tenant runs multiple apps that should be telemetered
   * separately.
   */
  applicationId?: string;

  /**
   * When true, the native SDK skips real attestation and returns a canned
   * `allow` result. Intended for CI/E2E tests and demo flows.
   */
  mockTpm?: boolean;
}

/** Result of a successful verify() call. */
export interface VerifyResult {
  /** The verifier's decision. */
  verdict: Verdict;
  /** Stable, per-device opaque identifier minted by the verifier. */
  deviceId: string;
  /**
   * Coarse TPM-class label, e.g. `tpm20-firmware`, `tpm20-discrete`,
   * `hardware-keystore`, `secure-enclave-app-attest`.
   */
  tpmClass: string;
  /** JSON-encoded posture/claims blob the verifier asserts about this device. */
  posture: string;
  /** Human-readable reason for the verdict; useful for logs & UI hints. */
  reason: string;
}

/** Discriminated error surface from the bridge. */
export class RootHeraldError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RootHeraldError';
    this.code = code;
  }
}

/** Options passed to {@link useVerifyDevice}. */
export interface UseVerifyDeviceOptions {
  /** Logical action being protected, e.g. `signup`, `login`, `checkout`. */
  action: string;
  /** If true, calls verify() automatically on mount. Default: false. */
  autoStart?: boolean;
  /** Optional client to reuse. If omitted, the hook reads one from context. */
  client?: import('./client.js').RootHeraldClient;
}

/** Return value from {@link useVerifyDevice}. */
export interface UseVerifyDeviceResult {
  /** Trigger a verify() call. Multiple in-flight calls are debounced — only the latest result wins. */
  verify: () => Promise<VerifyResult | null>;
  /** True while a verify() call is in progress. */
  loading: boolean;
  /** The most recent error, or null. */
  error: Error | null;
  /** The most recent result, or null. */
  result: VerifyResult | null;
  /** Reset state without firing a new verify(). */
  reset: () => void;
}
