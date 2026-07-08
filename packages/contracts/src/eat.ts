/**
 * Shared attestation enums for RootHerald.
 *
 * The RootHerald appraisal vocabulary — ACR/AMR URNs, EAR status, verdict,
 * attestation type, and platform — shared by the Background-Check verdict DTOs
 * in `sdk-api.ts`. Pure types; no runtime code.
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
