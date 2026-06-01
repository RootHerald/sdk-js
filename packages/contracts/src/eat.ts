/**
 * EAT (Entity Attestation Token) claim types for RootHerald.
 *
 * Based on RFC 9711 (Entity Attestation Token) with RootHerald-specific
 * extensions. These claims are present in the JWT issued by /api/v1/token.
 *
 * The token is composite: standard OIDC user-auth claims sit at the top level,
 * and all device attestation claims are nested inside the `rootherald_device`
 * container. See ADR-0012 and docs/architecture/contracts/attestation-claims.md.
 */

// ---------------------------------------------------------------------------
// ACR URN registry (docs/architecture/contracts/acr-values.md)
// ---------------------------------------------------------------------------

/**
 *  Root Herald ACR URN — the full set of supported Authentication Context Class
 * Reference values. Returned as the `acr` claim in issued tokens and accepted
 * in `acr_values` authorize parameters.
 *
 * See docs/architecture/contracts/acr-values.md for full definitions.
 */
export type AcrUrn =
  | "urn:rootherald:device:any"
  | "urn:rootherald:device:high"
  | "urn:rootherald:user:1fa"
  | "urn:rootherald:user:2fa"
  | "urn:rootherald:user:phr"
  | "urn:rootherald:user:phrh"
  | "urn:rootherald:user:phrh:fresh";

// ---------------------------------------------------------------------------
// RFC 8176 Authentication Method Reference values
// ---------------------------------------------------------------------------

/**
 * RFC 8176 Authentication Method Reference values. Used in the `amr` claim.
 * Only these 21 values are valid in  Root Herald tokens; no custom extensions.
 */
export type AmrValue =
  | "face"
  | "fpt"
  | "geo"
  | "hwk"
  | "iris"
  | "kba"
  | "mca"
  | "mfa"
  | "otp"
  | "pin"
  | "pop"
  | "pwd"
  | "rba"
  | "retina"
  | "sc"
  | "sms"
  | "swk"
  | "tel"
  | "user"
  | "vbm"
  | "wia";

// ---------------------------------------------------------------------------
// EAR status (draft-ietf-rats-ear-03)
// ---------------------------------------------------------------------------

/**
 * EAR (EAT Attestation Result) status. Aligns with RATS trustworthiness tiers
 * defined in draft-ietf-rats-ear-03.
 *
 * - "affirming"        — all evaluated dimensions pass at the highest tier
 * - "warning"          — one or more dimensions degraded but not disqualifying
 * - "contraindicated"  — device should not be trusted
 */
export type EarStatus = "affirming" | "warning" | "contraindicated";

// ---------------------------------------------------------------------------
// Legacy types (preserved for backward compatibility — do not use in new code)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use `EarStatus` instead. Kept for backward compatibility
 * with code written against the pre-ADR-0012 flat schema.
 */
export type AssuranceLevel = "high" | "reduced" | "unverified";

/** Verdict of the attestation evaluation. */
export type Verdict = "pass" | "fail" | "warn";

/** The hardware/platform attestation mechanism used. */
export type AttestationType =
  | "tpm20"
  | "apple-se"
  | "android-ka"
  | "ios-appattest"
  | "unknown";

/** Client platform. */
export type Platform = "windows" | "linux" | "macos" | "android" | "ios";

// ---------------------------------------------------------------------------
// AR4SI trustworthiness vector (draft-ietf-rats-ear-03)
// ---------------------------------------------------------------------------

/**
 * 8-dimension AR4SI trustworthiness vector. Each dimension is an integer:
 *   0 = unknown / not evaluated
 *   1 = warning (degraded, but not contraindicated)
 *   2 = affirming (fully trusted)
 */
export interface EarTrustworthinessVector {
  instance_identity?: number;
  configuration?: number;
  executables?: number;
  file_system?: number;
  hardware?: number;
  runtime_opaque?: number;
  sourced_data?: number;
  storage_opaque?: number;
}

// ---------------------------------------------------------------------------
// Nested device container
// ---------------------------------------------------------------------------

/**
 * All device attestation claims nested inside the `rootherald_device`
 * container. See docs/architecture/contracts/attestation-claims.md.
 */
export interface RootHeraldDeviceClaims {
  // ---- EAT-shaped claims (RFC 9711) ----

  /**
   * EAT profile identifier.
   * Fixed value: "tag:rootherald.io,2026:tpm20-v1".
   */
  eat_profile: "tag:rootherald.io,2026:tpm20-v1";

  /**
   * Universal Entity ID — the  Root Herald device UUID.
   * Per RFC 9711 §4.2.1.
   */
  ueid: string;

  // ---- EAR claims (draft-ietf-rats-ear-03) ----

  /** Overall EAR result for this device. */
  ear_status: EarStatus;

  /** 8-dimension AR4SI trustworthiness vector. Optional for reduced-assurance paths. */
  ear_trustworthiness_vector?: EarTrustworthinessVector;

  // ----  Root Herald attestation claims ----

  /** Overall attestation verdict. Simplified alias for consumers who skip the vector. */
  verdict: Verdict;

  /** Attestation mechanism used. */
  attestation_type: AttestationType;

  /** Unix seconds when attestation was submitted. Distinct from the JWT `iat`. */
  attested_at: number;

  // ---- Optional detail claims ----

  /** True if a TPM quote signature was verified server-side. */
  quote_verified?: boolean;

  /** True if secure boot state was verified. */
  secure_boot_verified?: boolean;

  /** True if the server replayed the event log and it matched client PCRs. */
  event_log_verified?: boolean;

  /**
   * Hex digest of the PCR measurement digest used in the quote.
   * Format: "sha256:<hex>".
   */
  pcr_hash?: string;

  /** Client platform. */
  platform?: Platform;

  /** Hardware description string (e.g. "TPM 2.0" or "Apple M2"). */
  hardware_model?: string;
}

// ---------------------------------------------------------------------------
// Composite JWT claim schema
// ---------------------------------------------------------------------------

/**
 * Top-level OIDC +  Root Herald extension claims for the composite attestation
 * token. Standard OIDC claims (`iss`, `sub`, `aud`, `acr`, `amr`, `auth_time`)
 * are at the top. All device claims are inside `rootherald_device`.
 *
 * See ADR-0012 and docs/architecture/contracts/attestation-claims.md.
 */
export interface AttestationTokenTopLevel {
  // ---- Standard JWT claims (RFC 7519) ----

  /**  Root Herald issuer URL (e.g. https://rootherald.example.com). */
  iss: string;

  /** Stable user ID (UUID). For device-only ACR tiers this is the device principal UUID. */
  sub: string;

  /** Relying party client_id. */
  aud: string;

  /** Issued-at unix seconds. */
  iat: number;

  /** Not-before unix seconds. */
  nbf: number;

  /** Expiry unix seconds. Recommended 5-minute TTL for attestation tokens. */
  exp: number;

  /** Token ID (UUID). Used for replay prevention. */
  jti: string;

  // ---- OIDC authentication claims ----

  /** The single ACR URN that was satisfied during this authorization. */
  acr: AcrUrn;

  /** Authentication methods used, per RFC 8176. Empty array for device-only tiers. */
  amr: AmrValue[];

  /** Unix seconds when the most recent user authentication completed. */
  auth_time: number;

  // ----  Root Herald top-level extension ----

  /**
   * Verbatim ACR values the RP submitted in the authorize request, preserved
   * for audit. Distinct from `acr` which is the single satisfied value.
   */
  requested_acr_values: string[];

  // ---- Nested device container ----

  /** All device attestation claims. Always present in  Root Herald tokens. */
  rootherald_device: RootHeraldDeviceClaims;
}

/**
 * Full composite attestation token claim set.
 *
 * Alias for `AttestationTokenTopLevel`. The name `AttestationTokenClaims` is
 * preserved for backward compatibility with code importing this type by name.
 */
export type AttestationTokenClaims = AttestationTokenTopLevel;
