/**
 * CAEP (Continuous Access Evaluation Protocol) event types and SET envelope.
 *
 * Events are delivered as SET JWTs (RFC 8417). Each SET carries one CAEP
 * event in its `events` map. Consumers should deduplicate by `jti`.
 *
 * References:
 *   - RFC 8417: Security Event Token (SET)
 *   - OpenID CAEP specification
 */

import type { AssuranceLevel } from "./eat.js";

// ---- Event type URI constants ----

/** Emitted when an attestation completes successfully or with a warning. */
export const CAEP_ATTESTATION_COMPLETED =
  "tag:rootherald.io,2026:event-type:attestation-completed" as const;

/** Emitted when an attestation fails (e.g. nonce mismatch, quote failure). */
export const CAEP_ATTESTATION_FAILED =
  "tag:rootherald.io,2026:event-type:attestation-failed" as const;

/** Emitted when a device's assurance level changes. */
export const CAEP_COMPLIANCE_CHANGE =
  "tag:rootherald.io,2026:event-type:compliance-change" as const;

/** Emitted when a session is revoked. */
export const CAEP_SESSION_REVOKED =
  "tag:rootherald.io,2026:event-type:session-revoked" as const;

/** Emitted when a device enrollment is revoked. */
export const CAEP_ENROLLMENT_REVOKED =
  "tag:rootherald.io,2026:event-type:enrollment-revoked" as const;

/** Emitted when a device has not attested within the configured staleness window. */
export const CAEP_DEVICE_STALE =
  "tag:rootherald.io,2026:event-type:device-stale" as const;

/** Union of all known event type URIs. */
export type CaepEventTypeUri =
  | typeof CAEP_ATTESTATION_COMPLETED
  | typeof CAEP_ATTESTATION_FAILED
  | typeof CAEP_COMPLIANCE_CHANGE
  | typeof CAEP_SESSION_REVOKED
  | typeof CAEP_ENROLLMENT_REVOKED
  | typeof CAEP_DEVICE_STALE;

// ---- Per-event payload types ----

/** Payload for attestation-completed events. */
export interface AttestationCompletedPayload {
  device_id: string;
  session_id: string;
  verdict: "pass" | "fail" | "warn";
  assurance_level: AssuranceLevel;
  attested_at: number;
  report_id: string;
}

/** Payload for attestation-failed events. */
export interface AttestationFailedPayload {
  device_id: string;
  session_id: string;
  reason: string;
  failed_at: number;
}

/** Payload for compliance-change events. */
export interface ComplianceChangePayload {
  device_id: string;
  previous_assurance_level: AssuranceLevel;
  current_assurance_level: AssuranceLevel;
  changed_at: number;
  reason?: string;
}

/** Payload for session-revoked events. */
export interface SessionRevokedPayload {
  session_id: string;
  device_id?: string;
  revoked_at: number;
  reason: string;
}

/** Payload for enrollment-revoked events. */
export interface EnrollmentRevokedPayload {
  device_id: string;
  revoked_at: number;
  reason: string;
}

/** Payload for device-stale events. */
export interface DeviceStalePayload {
  device_id: string;
  last_attested_at: number;
  staleness_threshold_seconds: number;
  detected_at: number;
}

/**
 * Discriminated union of all CAEP event payloads, keyed by event type URI.
 * The `events` map in a SET JWT will contain exactly one entry from this union.
 */
export type CaepEventMap =
  | { [K in typeof CAEP_ATTESTATION_COMPLETED]: AttestationCompletedPayload }
  | { [K in typeof CAEP_ATTESTATION_FAILED]: AttestationFailedPayload }
  | { [K in typeof CAEP_COMPLIANCE_CHANGE]: ComplianceChangePayload }
  | { [K in typeof CAEP_SESSION_REVOKED]: SessionRevokedPayload }
  | { [K in typeof CAEP_ENROLLMENT_REVOKED]: EnrollmentRevokedPayload }
  | { [K in typeof CAEP_DEVICE_STALE]: DeviceStalePayload };

/**
 * Typed representation of a parsed CAEP event (after extracting from SET).
 * Used in SDK callbacks (e.g. receiveCaepEvent).
 */
export type CaepEvent =
  | { type: typeof CAEP_ATTESTATION_COMPLETED; payload: AttestationCompletedPayload }
  | { type: typeof CAEP_ATTESTATION_FAILED; payload: AttestationFailedPayload }
  | { type: typeof CAEP_COMPLIANCE_CHANGE; payload: ComplianceChangePayload }
  | { type: typeof CAEP_SESSION_REVOKED; payload: SessionRevokedPayload }
  | { type: typeof CAEP_ENROLLMENT_REVOKED; payload: EnrollmentRevokedPayload }
  | { type: typeof CAEP_DEVICE_STALE; payload: DeviceStalePayload };

// ---- SET envelope (RFC 8417 §2.2) ----

/**
 * Subject Identifier per RFC 8417 + sub_id extension.
 *  Root Herald uses opaque format with the device_id as the identifier.
 */
export interface SubjectIdentifier {
  format: "opaque";
  id: string;
}

/**
 * The full SET JWT claims object wrapping a CAEP event.
 *
 * After decoding the JWT, validate:
 *   - Signature against JWKS at `{iss}/.well-known/jwks.json`
 *   - `iss` matches your configured  Root Herald issuer
 *   - `aud` matches your stream_id or client_id
 *   - `iat` is not in the future (allow small clock skew)
 *   - `jti` has not been seen before (deduplication)
 */
export interface SetJwtEnvelope {
  /**  Root Herald issuer URL — same value as EAT iss. */
  iss: string;

  /** Unix seconds when the SET was issued. */
  iat: number;

  /**
   * Unique SET ID (UUID). Consumers MUST deduplicate by this value to
   * achieve exactly-once processing.
   */
  jti: string;

  /** The subscriber's stream_id (or client_id). */
  aud: string;

  /**
   * Subject Identifier — identifies the device this event pertains to.
   * Format: { format: "opaque", id: "<device_id>" }
   */
  sub_id: SubjectIdentifier;

  /**
   * Map of event-type URI to event payload.
   *  Root Herald SETs carry exactly one event per envelope.
   */
  events: CaepEventMap;
}
