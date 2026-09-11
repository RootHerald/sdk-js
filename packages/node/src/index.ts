/**
 * @rootherald/node — Node.js server SDK for RootHerald device attestation.
 *
 * The SDK is the server -> server Background-Check client: the customer's server
 * relays a client-collected opaque blob to RootHerald with its `rh_sk_` secret
 * key and gets back a verdict. Use the `RootHeraldClient`:
 *   const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! });
 *   const { challengeId, challenge } = await rh.issueChallenge({ ask: ["identity"] });
 *   const result = await rh.verify(evidence, { challengeId });
 *
 * Device enrollment is a two-leg, backend-relayed handshake (the client holds no
 * key and never reaches RootHerald):
 *   const r = await rh.relayEnroll(enrollRequestBlob);   // POST /api/v1/attest/enroll
 *   // hand r.challenge to the client's EnrollComplete, then:
 *   await rh.relayActivate(activationResponse);          // POST /api/v1/attest/activate
 */

export { RootHeraldClient } from "./client.js";
export { verifyKeySignature } from "./key.js";

export type {
  AttestOptions,
  AttestResult,
  AttestResultKey,
  IssueChallengeOptions,
  RelayEnrollOptions,
  RootHeraldClientOptions,
} from "./client.js";
export type { CertifiedKeyJwk } from "./key.js";

// Error classes. `RootHeraldError` is the base of everything; the API errors
// extend `RootHeraldApiError`, which carries `.status` and the server's
// `.errorCode`. All are also importable from @rootherald/contracts (server
// context: @rootherald/contracts/server).
export {
  InvalidTokenError,
  RootHeraldError,
  TokenExpiredError,
} from "@rootherald/contracts";
export {
  AdmissionRefusedError,
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";

export type {
  AcrUrn,
  AmrValue,
  Ask,
  AttestationType,
  AttestationVerdict,
  CertifiedKey,
  ChallengeRequest,
  ChallengeResponse,
  DeviceVerdict,
  EarStatus,
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
  EvidenceBlob,
  KeyBlob,
  KeyCertification,
  Platform,
  RequestedDisclosureClass,
  TrustworthinessVector,
  Verdict,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "@rootherald/contracts";

// The enroll-relay result and activate-leg terminal response shape are
// canonical on the server subpath (server SDKs mirror one shape).
export type {
  RelayActivateResponse,
  RelayEnrollResult,
} from "@rootherald/contracts/server";

// Mobile attestation bridge (browser-only customers, mobile users): the
// request `verifyMobileEvidence` accepts, the tenant config it pairs with, and
// the link builder for the page that opens the companion app.
export type {
  BuildMobileAttestLinkOptions,
  MobileAppVerifyRequest,
  TenantMobileConfig,
} from "@rootherald/contracts";
export { buildMobileAttestLink } from "@rootherald/contracts";
