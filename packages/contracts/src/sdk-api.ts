/**
 * SDK API types — the shape returned by verify functions and the options
 * accepted by middleware. Pure types, no implementations.
 */

import type {
  AcrUrn,
  AmrValue,
  AttestationType,
  AttestationTokenClaims,
  EarStatus,
  Platform,
  Verdict,
} from "./eat.js";

/** Camel-cased trustworthiness vector. Mirrors `EarTrustworthinessVector` from the JWT. */
export interface TrustworthinessVector {
  instanceIdentity?: number;
  configuration?: number;
  executables?: number;
  fileSystem?: number;
  hardware?: number;
  runtimeOpaque?: number;
  sourcedData?: number;
  storageOpaque?: number;
}

/** Parsed device attestation claims, sourced from `rootherald_device` in the JWT. */
export interface DeviceVerdict {
  /** Device UUID (the JWT's `ueid`). */
  ueid: string;
  earStatus: EarStatus;
  verdict: Verdict;
  attestationType: AttestationType;
  attestedAt: Date;
  quoteVerified?: boolean;
  secureBootVerified?: boolean;
  eventLogVerified?: boolean;
  platform?: Platform;
  hardwareModel?: string;
  trustworthinessVector?: TrustworthinessVector;
}

/** Parsed attestation verdict from a verified RootHerald JWT. */
export interface AttestationVerdict {
  /** Satisfied ACR URN. */
  acr: AcrUrn;
  /** RFC 8176 authentication methods used. */
  amr: AmrValue[];
  /** When the user most recently authenticated. */
  authTime: Date;
  /** When the token expires. */
  expiresAt: Date;
  /** User ID from the `sub` claim. */
  userId: string;
  /** ACR values the RP requested, preserved for audit. */
  requestedAcrValues: AcrUrn[];
  /** Device attestation result. */
  device: DeviceVerdict;
  /** Raw JWT claim set, for consumers that need fields the SDK doesn't model. */
  raw: AttestationTokenClaims;
}

/** Options shared by token verification functions. */
export interface VerifyOptions {
  /** Expected issuer URL. */
  issuer: string;
  /** Expected audience (your client_id). String or array of strings. */
  audience?: string | string[];
  /** Clock skew tolerance in seconds. Default: 5. */
  clockTolerance?: number;
  /** JWKS cache TTL in milliseconds. Default: 3_600_000 (1 hour). */
  jwksCacheMs?: number;
  /** Override the JWKS URL. Default: `${issuer}/.well-known/jwks.json`. */
  jwksUri?: string;
}

/** Options for the Express/Fastify/Hono `requireAttestation` middleware. */
export interface RequireAttestationMiddlewareOptions extends VerifyOptions {
  /** Required ACR URN(s). Token is accepted if its ACR meets the highest in the list. */
  acrValues?: AcrUrn[];
  /** Reject if the user's `auth_time` is older than this many seconds. */
  maxAgeSeconds?: number;
  /**
   * Custom token extractor. Receives the raw request, returns the JWT string
   * (or null to trigger a 401). Default: Bearer token from `Authorization` header.
   */
  tokenExtractor?: (req: unknown) => string | null;
  /** Custom error responder. Default: JSON `{ error, code }` with a sensible status. */
  onError?: (err: Error, req: unknown, res: unknown) => void;
}
