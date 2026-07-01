/**
 * @rootherald/contracts — shared types for RootHerald SDK packages.
 *
 * Types only; no runtime code. Use this package directly if you need to
 * share types between your own code and a RootHerald SDK; otherwise
 * import what you need from @rootherald/node and the published SDK
 * pulls these types in transitively.
 */

export type {
  AcrUrn,
  AmrValue,
  AttestationTokenClaims,
  AttestationType,
  EarStatus,
  EarTrustworthinessVector,
  Platform,
  RootHeraldDeviceClaims,
  Verdict,
} from "./eat.js";

export type {
  AttestationVerdict,
  DeviceVerdict,
  RequireAttestationMiddlewareOptions,
  TrustworthinessVector,
  VerifyOptions,
} from "./sdk-api.js";

export type {
  ChallengeRequest,
  ChallengeResponse,
  EvidenceBlob,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "./background-check.js";

// Client ABI 2.0 enroll-handshake blobs (client-neutral). The client emits/
// consumes these; the customer's backend relays them. The server-side relay
// pair (RelayEnroll*/RelayActivate*) lives on "@rootherald/contracts/server".
export type {
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
} from "./enroll.js";

// Client-neutral errors. `RootHeraldError` is the base of everything;
// `TokenExpiredError` / `InvalidTokenError` come out of token verification.
// `RootHeraldApiError` is the base for the Background-Check API errors below.
export {
  InvalidTokenError,
  RootHeraldApiError,
  RootHeraldError,
  TokenExpiredError,
} from "./errors.js";

// SERVER-CONTEXT errors — raised only on the customer's backend (rh_sk_ path,
// via @rootherald/node or another server SDK), never in a browser bundle.
// These are now also exported from "@rootherald/contracts/server"; the root
// re-exports remain for backwards compatibility but are deprecated.
export {
  /** @deprecated import from `@rootherald/contracts/server` */
  ChallengeError,
  /** @deprecated import from `@rootherald/contracts/server` */
  InvalidEvidenceError,
  /** @deprecated import from `@rootherald/contracts/server` */
  InvalidSecretKeyError,
  /** @deprecated import from `@rootherald/contracts/server` */
  QuotaExceededError,
  /** @deprecated import from `@rootherald/contracts/server` */
  UnknownPolicyError,
} from "./errors.js";
