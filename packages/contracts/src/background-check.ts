/**
 * Background-Check (server -> server) wire DTOs.
 *
 * These mirror the frozen RootHerald HTTP contract for the server-side
 * appraisal flow:
 *   - C1  POST /api/v1/attestations/challenge  (relay-friendly nonce)
 *   - C2  POST /api/v1/attestations/verify     (server -> server appraise)
 *
 * The customer's dumb client collects an opaque evidence blob and hands it to
 * the customer's own server; that server calls these endpoints with its
 * `rh_sk_` secret key. The verdict reuses the EXISTING `AttestationVerdict`
 * shape (see `sdk-api.ts`) — there is no parallel verdict type.
 *
 * Pure types; no runtime code. These are the shapes the other-language SDKs
 * mirror against, so they are deliberately exact.
 */

import type { AttestationVerdict } from "./sdk-api.js";

/** Request body for `POST /api/v1/attestations/challenge` (C1). */
export interface ChallengeRequest {
  /**
   * Optional hint identifying the device the challenge is for. No pre-enrolled
   * device is required; the hint is advisory.
   */
  deviceHint?: string;
}

/** Response body (200) for `POST /api/v1/attestations/challenge` (C1). */
export interface ChallengeResponse {
  /** Opaque single-use challenge id; pass it back to verify (C2). */
  challengeId: string;
  /** base64-encoded nonce the client quotes over. */
  nonce: string;
  /** ISO 8601 timestamp after which the challenge is no longer valid. */
  expiresAt: string;
}

/**
 * Opaque device evidence blob. The SDK passes this through to the wire verbatim
 * — it is produced by the collector (sdk-native) and never inspected here.
 */
export type EvidenceBlob = unknown;

/** Request body for `POST /api/v1/attestations/verify` (C2). */
export interface VerifyAttestationRequest {
  /** The single-use challenge id returned by C1. */
  challengeId: string;
  /** The opaque evidence blob produced by the client collector. */
  evidence: EvidenceBlob;
  /**
   * A caller-named policy: a tenant-owned policy id/name or a
   * `rootherald:builtin:*` name. Resolved tenant-scoped + fail-closed
   * (unknown/foreign name => 422).
   */
  policy?: string;
  /** Opt-in EAT (signed JWT) output. Default false. */
  returnToken?: boolean;
}

/** Response body (200) for `POST /api/v1/attestations/verify` (C2). */
export interface VerifyAttestationResponse {
  /** The appraisal verdict — the EXISTING `AttestationVerdict` shape. */
  verdict: AttestationVerdict;
  /** The signed EAT JWT, present only when `returnToken: true` was requested. */
  token?: string;
}
