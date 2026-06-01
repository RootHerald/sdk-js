/**
 * Public SDK API interfaces for  Root Herald SDK packages.
 *
 * These are types only — no implementations. Downstream packages
 * (@rootherald/js, @rootherald/react, @rootherald/node) import these
 * interfaces and implement against them.
 */

import type {
  AcrUrn,
  AmrValue,
  AssuranceLevel,
  AttestationType,
  AttestationTokenClaims,
  EarStatus,
  Platform,
  Verdict,
} from "./eat.js";
import type { CaepEvent, SetJwtEnvelope } from "./caep.js";

// Re-export for consumer convenience
export type {
  AcrUrn,
  AmrValue,
  AssuranceLevel,
  AttestationType,
  EarStatus,
  Platform,
  Verdict,
};

// ---- ACR request options ----

/**
 * Options for requesting a specific ACR tier from the  Root Herald authorization
 * server. Used in `loginWithRedirect`, `RootHeraldSdkClientOptions.defaultAcr`,
 * and `RequireAttestationMiddlewareOptions`.
 */
export interface AcrRequestOptions {
  /**
   * Preference-ordered list of ACR URNs to request. The server satisfies the
   * highest achievable URN from the list.
   */
  acrValues?: AcrUrn[];

  /**
   * Maximum age in seconds for the user authentication. If `auth_time` is
   * older than `maxAge`, the server triggers re-authentication.
   */
  maxAge?: number;

  /**
   * If true, the ACR requirement is treated as essential: the server returns
   * `interaction_required` if it cannot be satisfied. Uses the OIDC `claims`
   * parameter with `essential: true` instead of `acr_values`.
   * Defaults to false.
   */
  essential?: boolean;
}

/**
 * Options passed to `loginWithRedirect` to control the authorization request.
 */
export interface LoginOptions extends AcrRequestOptions {
  /** Prompt behavior. "login" forces a new login; "none" returns an error if
   * the user is not already authenticated. */
  prompt?: "login" | "none";
  /** Opaque state value round-tripped through the authorization flow. */
  state?: string;
}

// ---- Token cache abstraction ----

/**
 * Token cache abstraction. Implement this to provide a custom storage
 * backend (e.g. IndexedDB, Redis, encrypted file).
 */
export interface TokenCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

// ---- Client configuration ----

/** Configuration options for RootHeraldSdkClient. */
export interface RootHeraldSdkClientOptions {
  /**  Root Herald issuer URL (e.g. https://rootherald.example.com). */
  issuer: string;

  /** The relying party's client_id, registered with RootHerald. */
  clientId: string;

  /** Redirect URI registered with  Root Herald for OAuth callback. */
  redirectUri: string;

  /**
   * OAuth scopes to request. Defaults to "openid attestation".
   */
  scope?: string;

  /**
   * Where to store tokens between page loads.
   * "memory"          - default; tokens lost on page reload
   * "localStorage"    - persists across tabs and page loads
   * "sessionStorage"  - persists across page loads within the tab
   * "custom"          - provide a `customCache` implementation
   */
  cacheLocation?: "memory" | "localStorage" | "sessionStorage" | "custom";

  /** Required when cacheLocation is "custom". */
  customCache?: TokenCache;

  /**
   * Client secret for the token exchange. Browser-based clients SHOULD NOT
   * set this — it defeats the purpose of public clients. Provided only for
   * development, testing, and backward compatibility with confidential-
   * client backends that don't yet support PKCE-only token exchange.
   * In production SPAs, use PKCE with a public client (no secret) or the
   * Backend-for-Frontend pattern with @rootherald/node.
   */
  clientSecret?: string;

  /**
   * Default ACR request options applied to every `loginWithRedirect` call
   * unless overridden by the call-site options.
   */
  defaultAcr?: AcrRequestOptions;
}

// ---- Attestation verdict ----

/**
 * Trustworthiness vector (AR4SI 8-dimension) in the SDK's camelCase form.
 * Maps directly from `rootherald_device.ear_trustworthiness_vector` in the JWT.
 */
export interface TrustworthinessVector {
  /** 0-2 */
  instanceIdentity?: number;
  /** 0-2 */
  configuration?: number;
  /** 0-2 */
  executables?: number;
  /** 0-2 */
  fileSystem?: number;
  /** 0-2 */
  hardware?: number;
  /** 0-2 */
  runtimeOpaque?: number;
  /** 0-2 */
  sourcedData?: number;
  /** 0-2 */
  storageOpaque?: number;
}

/**
 * SDK-parsed device attestation verdict, sourced from `rootherald_device` in
 * the JWT.
 */
export interface DeviceVerdict {
  /** Device UUID sourced from `ueid`. */
  ueid: string;
  /** EAR status: "affirming", "warning", or "contraindicated". */
  earStatus: EarStatus;
  /** Simplified verdict: "pass", "fail", or "warn". */
  verdict: Verdict;
  /** Attestation mechanism used. */
  attestationType: AttestationType;
  /** When attestation was submitted. */
  attestedAt: Date;
  quoteVerified?: boolean;
  secureBootVerified?: boolean;
  eventLogVerified?: boolean;
  platform?: Platform;
  hardwareModel?: string;
  trustworthinessVector?: TrustworthinessVector;
}

/**
 * Parsed and validated attestation verdict from a composite  Root Herald JWT.
 *
 * OIDC user-auth claims are at the top level. Device claims are in `device`.
 * See ADR-0012 and docs/architecture/contracts/attestation-claims.md.
 */
export interface AttestationVerdict {
  // ---- OIDC top-level claims ----

  /** Satisfied ACR URN. */
  acr: AcrUrn;

  /** RFC 8176 authentication methods used. */
  amr: AmrValue[];

  /** When the user most recently authenticated. */
  authTime: Date;

  /** When the token expires. */
  expiresAt: Date;

  /** User ID sourced from the `sub` claim. */
  userId: string;

  /** ACR values the RP requested, preserved for audit. */
  requestedAcrValues: AcrUrn[];

  // ---- Nested device container ----

  /** Parsed device attestation claims. */
  device: DeviceVerdict;

  // ---- Full raw claims ----

  /** Full raw JWT claim set for advanced consumers. */
  raw: AttestationTokenClaims;

  // ---- Deprecated backward-compat fields ----

  /**
   * @deprecated Use `device.verdict` instead.
   * Kept for backward compatibility with the pre-ADR-0012 flat schema.
   * Will be removed in Package 5.
   */
  verdict?: Verdict;

  /**
   * @deprecated Use `device.earStatus` to get the EAR status, or inspect
   * the `acr` URN for the combined user+device assurance tier. The old
   * `assuranceLevel` string ("high"/"reduced"/"unverified") no longer has a
   * direct equivalent in the composite schema.
   * Will be removed in Package 5.
   */
  assuranceLevel?: AssuranceLevel;

  /**
   * @deprecated Use `device.attestationType` instead.
   * Kept for backward compatibility with the pre-ADR-0012 flat schema.
   * Will be removed in Package 5.
   */
  attestationType?: AttestationType;

  /**
   * @deprecated Use `device.ueid` instead.
   * Kept for backward compatibility with the pre-ADR-0012 flat schema.
   * Will be removed in Package 5.
   */
  deviceId?: string;
}

// ---- Core client interface ----

/** Core browser/Node client interface for RootHerald. */
export interface RootHeraldSdkClient {
  /**
   * Initiates the OAuth PKCE redirect flow. Redirects the browser to
   * the  Root Herald authorization endpoint.
   */
  loginWithRedirect(options?: LoginOptions): Promise<void>;

  /**
   * Processes the redirect callback URL after the authorization server
   * redirects back. Call this on the redirect URI page.
   */
  handleRedirectCallback(url?: string): Promise<AttestationVerdict>;

  /**
   * Returns the cached verdict, or null if not authenticated or the
   * token has expired.
   */
  getVerdict(): Promise<AttestationVerdict | null>;

  /**
   * Returns the raw EAT JWT string for use in Authorization headers,
   * or null if not authenticated.
   */
  getToken(): Promise<string | null>;

  /**
   * Returns true if the user is authenticated and the attestation
   * verdict meets the specified requirements.
   */
  isVerified(options?: {
    /** Minimum ACR URN required. */
    minAcr?: AcrUrn;
    /**
     * @deprecated Use `minAcr` instead.
     * Minimum assurance level required. Defaults to "high".
     */
    minLevel?: AssuranceLevel;
    /** Maximum age of the user authentication in seconds. */
    maxAgeSeconds?: number;
  }): Promise<boolean>;

  /**
   * Clears the local token cache and optionally redirects to
   *  Root Herald logout.
   */
  logout(options?: { returnTo?: string }): Promise<void>;
}

// ---- React adapter types ----

/**
 * Props for RootHeraldProvider.
 * children is typed as unknown here to avoid a React dependency in
 * the contracts package; the actual adapter types it as ReactNode.
 */
export interface RootHeraldProviderProps {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  cacheLocation?: "memory" | "localStorage" | "sessionStorage";
  /** See RootHeraldSdkClientOptions.clientSecret for caveats. */
  clientSecret?: string;
  defaultAcr?: AcrRequestOptions;
  children: unknown;
}

/** Return value of useAttestation() React hook. */
export interface UseAttestationResult {
  verdict: AttestationVerdict | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  /** Raw JWT string for use in Authorization headers, or null if not authenticated. */
  token: string | null;
  login: (options?: LoginOptions) => Promise<void>;
  logout: (options?: { returnTo?: string }) => Promise<void>;
}

/**
 * Props for RequireAttestation wrapper component.
 * fallback and children are unknown for the same reason as
 * RootHeraldProviderProps.children.
 */
export interface RequireAttestationProps {
  /**
   * @deprecated Use `acrValues` instead.
   * Minimum assurance level required.
   */
  minLevel?: AssuranceLevel;
  /** Minimum ACR URN(s) to require. */
  acrValues?: AcrUrn[];
  maxAgeSeconds?: number;
  /** Rendered while loading or when attestation is insufficient. */
  fallback?: unknown;
  children: unknown;
}

// ---- Node server SDK types ----

/** Options shared by token verification functions. */
export interface VerifyOptions {
  /** Expected issuer. Validation fails if iss does not match. */
  issuer: string;
  /** Expected audience (client_id). Accepts string or array. */
  audience?: string | string[];
  /** Clock skew tolerance in seconds. Defaults to 30. */
  clockTolerance?: number;
  /** JWKS cache TTL in milliseconds. Defaults to 300000 (5 min). */
  jwksCacheMs?: number;
}

/** Options for Express/Fastify/Hono attestation middleware. */
export interface RequireAttestationMiddlewareOptions extends VerifyOptions {
  /**
   * @deprecated Use `acrValues` instead.
   * Minimum assurance level required.
   */
  minLevel?: AssuranceLevel;
  /** Required ACR URN(s). The middleware enforces the highest in the list. */
  acrValues?: AcrUrn[];
  /** Reject tokens where auth_time is older than this many seconds. */
  maxAgeSeconds?: number;
  /**
   * Custom token extractor. Receives the raw request object and returns
   * the JWT string, or null to trigger a 401.
   * Default: extract Bearer token from Authorization header.
   */
  tokenExtractor?: (req: unknown) => string | null;
  /**
   * Custom error handler. Default: writes JSON { error, code } with
   * appropriate HTTP status.
   */
  onError?: (err: Error, req: unknown, res: unknown) => void;
}

/** Options for the CAEP webhook receiver. */
export interface ReceiveCaepEventOptions {
  /** Expected issuer. JWKS is fetched from {issuer}/.well-known/jwks.json. */
  issuer: string;
  /** Callback invoked for each validated CAEP event. */
  onEvent: (
    event: CaepEvent,
    raw: { jti: string; iat: number }
  ) => Promise<void> | void;
  /** Clock skew tolerance in seconds. Defaults to 30. */
  tolerance?: number;
}

/** Options for SSF Management API client. */
export interface SsfClientOptions {
  /**  Root Herald issuer URL. */
  issuer: string;
  /** Relying party client_id. */
  clientId: string;
  /** Relying party client_secret. */
  clientSecret: string;
}

/** Representation of an SSF delivery stream. */
export interface SsfStream {
  streamId: string;
  url: string;
  eventTypes: string[];
  status: "enabled" | "paused" | "disabled";
  createdAt: string;
}

/** Client for the  Root Herald SSF Management API. */
export interface SsfClient {
  createStream(config: {
    url: string;
    eventTypes: string[];
    delivery?: "push" | "poll";
  }): Promise<SsfStream>;

  getStream(streamId: string): Promise<SsfStream>;

  listStreams(): Promise<SsfStream[]>;

  updateStream(
    streamId: string,
    update: Partial<Pick<SsfStream, "url" | "eventTypes" | "status">>
  ): Promise<SsfStream>;

  deleteStream(streamId: string): Promise<void>;

  verifyStream(streamId: string): Promise<{ ok: boolean }>;
}

// Re-export CaepEvent and SetJwtEnvelope so node SDK consumers can import from sdk-api
export type { CaepEvent, SetJwtEnvelope };
