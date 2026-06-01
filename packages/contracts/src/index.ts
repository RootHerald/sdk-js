/**
 * @rootherald/contracts — shared type contracts for  Root Herald SDK packages.
 *
 * This package exports the canonical type definitions for:
 *   - EAT (Entity Attestation Token) JWT claim schema (composite shape, ADR-0012)
 *   - ACR URN registry (ADR-0011)
 *   - RFC 8176 AMR values
 *   - CAEP event payloads and SET JWT envelope
 *   - Public SDK API interfaces (@rootherald/js, @rootherald/react, @rootherald/node)
 *   - Shared error class hierarchy
 *
 * No runtime logic lives here — only types, interfaces, and error classes.
 */

export type {
  // New composite schema types
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationTokenTopLevel,
  EarStatus,
  EarTrustworthinessVector,
  RootHeraldDeviceClaims,
  // Legacy types preserved for backward compatibility
  AssuranceLevel,
  AttestationType,
  Platform,
  Verdict,
} from "./eat.js";

export {
  CAEP_ATTESTATION_COMPLETED,
  CAEP_ATTESTATION_FAILED,
  CAEP_COMPLIANCE_CHANGE,
  CAEP_DEVICE_STALE,
  CAEP_ENROLLMENT_REVOKED,
  CAEP_SESSION_REVOKED,
} from "./caep.js";

export type {
  AttestationCompletedPayload,
  AttestationFailedPayload,
  CaepEvent,
  CaepEventMap,
  CaepEventTypeUri,
  ComplianceChangePayload,
  DeviceStalePayload,
  EnrollmentRevokedPayload,
  SessionRevokedPayload,
  SetJwtEnvelope,
  SubjectIdentifier,
} from "./caep.js";

export type {
  AcrRequestOptions,
  AttestationVerdict,
  DeviceVerdict,
  LoginOptions,
  RootHeraldSdkClient,
  RootHeraldSdkClientOptions,
  RootHeraldProviderProps,
  ReceiveCaepEventOptions,
  RequireAttestationMiddlewareOptions,
  RequireAttestationProps,
  SsfClient,
  SsfClientOptions,
  SsfStream,
  TokenCache,
  TrustworthinessVector,
  UseAttestationResult,
  VerifyOptions,
} from "./sdk-api.js";

export {
  AuthenticationTooOldError,
  InsufficientAcrError,
  InsufficientAssuranceError,
  InvalidVerdictError,
  RootHeraldError,
  SsfApiError,
  StaleAttestationError,
  TokenExpiredError,
  WebhookSignatureError,
} from "./errors.js";

export { ACR_ORDER, acrRank, legacyLevelToAcr } from "./acr.js";
