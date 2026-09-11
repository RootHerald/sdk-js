/**
 * Background-Check (server -> server) wire DTOs.
 *
 * These mirror the frozen RootHerald HTTP contract for the server-side
 * appraisal flow:
 *   - C1  POST /api/v1/attest/challenge  (relay-friendly nonce)
 *   - C2  POST /api/v1/attest/verify     (server -> server appraise)
 *
 * The customer's dumb client collects an opaque evidence blob and hands it to
 * the customer's own server; that server calls these endpoints with its
 * `rh_sk_` secret key. The verdict reuses the EXISTING `AttestationVerdict`
 * shape (see `sdk-api.ts`) — there is no parallel verdict type.
 *
 * The challenge carries the ask. What the device is being asked to prove is
 * fixed at C1, stored on the server's challenge row, and echoed to the client
 * inside the `challenge` string; C2 appraises against that stored ask, so a
 * caller cannot widen or weaken it between the two legs.
 *
 * Pure types; no runtime code. These are the shapes the other-language SDKs
 * mirror against, so they are deliberately exact.
 */

import type { AttestationVerdict } from "./sdk-api.js";

/**
 * One thing a challenge asks the device to prove.
 *
 * - `identity` — this is a specific, enrolled TPM (quote under the enrolled AK).
 * - `posture`  — boot configuration (event log replay, Secure Boot, PCRs).
 * - `key`      — certify a freshly created, TPM-resident signing key under the
 *                AK, so the caller can later trust signatures from it.
 */
export type Ask = "identity" | "posture" | "key";

/** Request body for `POST /api/v1/attest/challenge` (C1). */
export interface ChallengeRequest {
  /**
   * Optional hint identifying the device the challenge is for. No pre-enrolled
   * device is required; the hint is advisory.
   */
  deviceHint?: string;
  /**
   * What the device is asked to prove. Omitted => `["identity", "posture"]`,
   * which is exactly what a challenge did before the ask existed. Bound to the
   * challenge row; the client learns it from {@link ChallengeResponse.challenge}.
   */
  ask?: Ask[];
  /**
   * What the certified key will be used for. Read only when `ask` contains
   * `"key"`; ignored otherwise. `"sign"` is the only purpose today.
   */
  keyPurpose?: "sign";
}

/** Response body (200) for `POST /api/v1/attest/challenge` (C1). */
export interface ChallengeResponse {
  /** Opaque single-use challenge id; pass it back to verify (C2). */
  challengeId: string;
  /** base64-encoded nonce the client quotes over. */
  nonce: string;
  /** ISO 8601 timestamp after which the challenge is no longer valid. */
  expiresAt: string;
  /**
   * The string to relay to the client verbatim. Format:
   *
   *   `rhc1.<base64url nonce>.<base64url ask-json>`
   *
   * The third segment decodes to `{"ask":[...]}`, plus `"purpose":"sign"` when
   * the ask contains `"key"` (the request field is `keyPurpose`; the echoed key
   * is `purpose`, matching {@link KeyCertification.purpose}).
   *
   * The client parses it to learn the nonce and the ask; nothing else on the
   * customer side needs to. The TPM signs the NONCE ONLY — the ask segment is
   * not covered by the quote. It does not need to be: the ask is bound by the
   * server's challenge row, keyed by `challengeId`, and C2 appraises against
   * that row, so tampering with the third segment in transit changes what the
   * client collects but not what the server demands.
   */
  challenge: string;
}

/**
 * The certification of a freshly created signing key, present in the evidence
 * when the challenge asked for `"key"`. All fields base64.
 *
 * The client creates a P-256 key under the TPM's storage hierarchy, then runs
 * `TPM2_Certify` over it with the enrolled AK, qualifying the certification
 * with the challenge nonce. The wrapped private key (the {@link KeyBlob}) NEVER
 * travels to RootHerald — only the public area and the AK's statement about it.
 */
export interface KeyCertification {
  /** `TPM2B_PUBLIC` of the new key. */
  publicArea: string;
  /** `TPM2B_ATTEST` emitted by `TPM2_Certify` (a `TPMS_ATTEST` of type CERTIFY). */
  attest: string;
  /** `TPMT_SIGNATURE` over `attest`, made by the enrolled AK. */
  signature: string;
  /** Echo of the challenge's `keyPurpose`; `"sign"` is the only purpose today. */
  purpose: "sign";
}

/**
 * Opaque device evidence blob. The SDK passes this through to the wire verbatim
 * — it is produced by the collector (the native SDK) and never inspected here.
 *
 * Documented contents, for the server and the native SDKs that agree on them
 * (the type stays `unknown` because no JS SDK reads inside it):
 *
 *   - the quote, event log, and AK material the existing asks need;
 *   - `keyCertification?: KeyCertification` — present only when the challenge
 *     asked for `"key"`. See {@link KeyCertification}.
 */
export type EvidenceBlob = unknown;

/**
 * How much device detail the caller is asking the appraisal to disclose,
 * from the least-revealing pass/fail token up to the full claim set. Omit to
 * accept the policy's default disclosure ceiling.
 */
export type RequestedDisclosureClass = "verdict" | "pseudonymous" | "derived" | "full";

/** Request body for `POST /api/v1/attest/verify` (C2). */
export interface VerifyAttestationRequest {
  /** The single-use challenge id returned by C1. */
  challengeId: string;
  /** The opaque evidence blob produced by the client collector. */
  evidence: EvidenceBlob;
  /**
   * Optional disclosure ceiling the caller is requesting for this appraisal.
   * Omitted => the resolved policy's default disclosure applies.
   */
  requestedDisclosureClass?: RequestedDisclosureClass;
}

/**
 * A TPM-resident signing key the appraisal certified, returned from C2 when
 * the challenge asked for `"key"` and the verdict passed.
 *
 * Sits at the `pseudonymous` disclosure rung: `keyId` identifies the key, not
 * the device, and a fresh key is certified per ask.
 */
export interface CertifiedKey {
  /** RootHerald's id for this key. Stable for the key's lifetime. */
  keyId: string;
  /** The public key, as a JWK. P-256 is the only curve today. */
  jwk: {
    kty: "EC";
    crv: "P-256";
    x: string;
    y: string;
  };
  /** What the key is certified for; echoes the challenge's `keyPurpose`. */
  purpose: "sign";
  /**
   * base64 `authPolicy` digest from the key's public area, when the key was
   * created with one. Absent for a key with no policy.
   */
  authPolicy?: string;
  /** ISO 8601 timestamp of the certification. */
  certifiedAt: string;
}

/**
 * Opaque handle to the wrapped private key, held by the CALLER, never by
 * RootHerald. The native SDK returns one from the `"key"` ask and takes it back
 * for `LoadKey`; the caller stores it and no SDK ever parses it.
 *
 * For the record only: base64url of `rhk1` magic + version byte + parent id +
 * `TPM2B_PUBLIC` + `TPM2B_PRIVATE`, roughly 300 bytes for a P-256 key. The
 * private half is wrapped by the TPM's storage parent and is useless off the
 * TPM that created it.
 */
export type KeyBlob = string;

/** Response body (200) for `POST /api/v1/attest/verify` (C2). */
export interface VerifyAttestationResponse {
  /** The appraisal verdict — the EXISTING `AttestationVerdict` shape. */
  verdict: AttestationVerdict;
  /**
   * The assurance claims the device satisfied for the resolved policy (e.g.
   * ACR/AMR-derived capability tags). Use these to gate capabilities on the
   * customer backend. Omitted when the server returns none.
   */
  assuranceClaimsMet?: string[];
  /**
   * `true` when the device is not yet enrolled and the caller should drive the
   * enroll/re-attestation flow before trusting the verdict. Drives the
   * documented attest-first / enroll-on-miss pattern.
   */
  enrollmentRequired?: boolean;
  /**
   * The certified signing key. Present only when the challenge asked for
   * `"key"` AND the verdict is a pass; a failing verdict certifies nothing,
   * whatever the evidence carried.
   */
  key?: CertifiedKey;
}
