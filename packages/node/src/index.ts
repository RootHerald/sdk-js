/**
 * @rootherald/node — Node.js server SDK for RootHerald device attestation.
 *
 * The SDK is the server -> server Background-Check client: the customer's server
 * relays a client-collected opaque blob to RootHerald with its `rh_sk_` secret
 * key and gets back a verdict. Use the `RootHeraldClient`:
 *   const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! });
 *   const { nonce, challenge } = await rh.issueChallenge({ ask: ["identity"] });
 *   const result = await rh.verify(evidence, { nonce });
 *
 * Device enrollment is a two-leg, backend-relayed handshake (the client holds no
 * key and never reaches RootHerald):
 *   const r = await rh.relayEnroll(enrollRequestBlob);   // POST /api/v1/attest/enroll
 *   // hand r.challenge to the client's EnrollComplete, then:
 *   const { deviceId } = await rh.relayActivate(activationResponse); // POST /api/v1/attest/activate
 */

export { RootHeraldClient } from "./client.js";
export { verifyKeySignature } from "./key.js";

export type {
  AttestOptions,
  AttestResult,
  AttestResultKey,
  IssueChallengeOptions,
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
  ActivationRefusedError,
  AdmissionRefusedError,
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";

export type {
  AcrUrn,
  AmrValue,
  AppAttestEnrollRequestBlob,
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
  SecureEnclaveEnrollRequestBlob,
  TpmEnrollRequestBlob,
  TrustworthinessVector,
  Verdict,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "@rootherald/contracts";

// The enroll-relay result and activate-leg terminal response shape are
// canonical on the server subpath (server SDKs mirror one shape).
export type {
  RelayActivateResponse,
  RelayEnrollResponse,
  RelayEnrollResult,
} from "@rootherald/contracts/server";

// Mobile attestation bridge (browser-only customers, mobile users): the
// requests the bridge forwards to your registered URLs, the tenant config it
// pairs with, and the link builder for the page that opens the companion app.
export type {
  BuildMobileAttestLinkOptions,
  MobileAppEnrollRequest,
  MobileAppVerifyRequest,
  TenantMobileConfig,
} from "@rootherald/contracts";
export { buildMobileAttestLink } from "@rootherald/contracts";
