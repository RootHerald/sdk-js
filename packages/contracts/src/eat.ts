/**
 * EAT (Entity Attestation Token) claim types for RootHerald.
 *
 * RFC 9711 EAT + RFC 9470 ACR step-up, with RootHerald-specific extensions.
 * These are the claims that appear in a token issued by /api/v1/token.
 */

/** The full set of ACR URNs RootHerald accepts. */
export type AcrUrn =
  | "urn:rootherald:device:any"
  | "urn:rootherald:device:high"
  | "urn:rootherald:user:1fa"
  | "urn:rootherald:user:2fa"
  | "urn:rootherald:user:phr"
  | "urn:rootherald:user:phrh"
  | "urn:rootherald:user:phrh:fresh";

/** RFC 8176 Authentication Method Reference values. */
export type AmrValue =
  | "face" | "fpt" | "geo" | "hwk" | "iris" | "kba" | "mca" | "mfa"
  | "otp" | "pin" | "pop" | "pwd" | "rba" | "retina" | "sc" | "sms"
  | "swk" | "tel" | "user" | "vbm" | "wia";

/**
 * EAR (EAT Attestation Result) status from draft-ietf-rats-ear-03.
 * - affirming        — all evaluated dimensions pass
 * - warning          — degraded but not disqualifying
 * - contraindicated  — device should not be trusted
 */
export type EarStatus = "affirming" | "warning" | "contraindicated";

/** Simplified verdict for consumers who don't want to interpret the trustworthiness vector. */
export type Verdict = "pass" | "fail" | "warn";

/** Hardware/platform attestation mechanism. */
export type AttestationType =
  | "tpm20" | "apple-se" | "android-ka" | "ios-appattest" | "unknown";

/** Client platform. */
export type Platform = "windows" | "linux" | "macos" | "android" | "ios";

/**
 * AR4SI 8-dimension trustworthiness vector.
 * Each dimension: 0 = unknown, 1 = warning, 2 = affirming.
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

/** All device attestation claims, nested inside `rootherald_device`. */
export interface RootHeraldDeviceClaims {
  eat_profile: "tag:rootherald.io,2026:tpm20-v1";
  ueid: string;
  ear_status: EarStatus;
  ear_trustworthiness_vector?: EarTrustworthinessVector;
  verdict: Verdict;
  attestation_type: AttestationType;
  /** Unix seconds when attestation was submitted (distinct from JWT `iat`). */
  attested_at: number;
  quote_verified?: boolean;
  secure_boot_verified?: boolean;
  event_log_verified?: boolean;
  /** Hex digest of the PCR measurement digest, format "sha256:<hex>". */
  pcr_hash?: string;
  platform?: Platform;
  hardware_model?: string;
}

/** Composite attestation token: OIDC at top level, device claims in `rootherald_device`. */
export interface AttestationTokenClaims {
  // RFC 7519 standard claims
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  nbf: number;
  exp: number;
  jti: string;

  // OIDC authentication claims
  acr: AcrUrn;
  amr: AmrValue[];
  auth_time: number;

  /** ACR values the RP requested, preserved for audit. */
  requested_acr_values: string[];

  /** Device attestation claims. Always present in RootHerald tokens. */
  rootherald_device: RootHeraldDeviceClaims;
}
