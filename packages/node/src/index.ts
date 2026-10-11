/**
 * @rootherald/node — Node.js server SDK for RootHerald device attestation.
 *
 * The SDK is the server -> server Background-Check client: the customer's server
 * relays client-collected opaque blobs to RootHerald with its `rh_sk_` secret
 * key. Three ceremonies, two legs each, on the `RootHeraldClient`:
 *
 *   const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! });
 *
 *   // enroll: the installation's AK is bound to its EK (the client keeps the AK blob)
 *   const { challenge } = await rh.relayEnroll(enrollRequestBlob);    // POST /api/v1/attest/enroll
 *   const { deviceId } = await rh.relayActivate(activationResponse);   // POST /api/v1/attest/activate
 *
 *   // attest: the AK quotes what the challenge asked
 *   const { nonce, challenge } = await rh.issueChallenge({ ask: ["identity"] });
 *   const result = await rh.verify(evidence, { nonce });
 *
 *   // mint a key: the AK certifies a new device-bound key
 *   const kc = await rh.issueKeyChallenge({ purpose: "sign", expectedDevices: [deviceId] });
 *   const key = await rh.certifyKey(kc.nonce, certification);
 *   verifyKeySignature(key.jwk, message, signature);                   // no RootHerald call
 */

export { RootHeraldClient } from "./client.js";
export { verifyKeySignature } from "./key.js";

export type {
  AttestOptions,
  AttestResult,
  CertifiedKeyResult,
  IssueChallengeOptions,
  IssueKeyChallengeOptions,
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
  InvalidAskError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
  RootHeraldApiError,
  UnknownPolicyError,
  type RefusingBudget,
} from "@rootherald/contracts/server";

export type {
  AcrUrn,
  AkBlob,
  AmrValue,
  AppAttestEnrollRequestBlob,
  AppAttestKeyCertification,
  Ask,
  AttestationKeyPublic,
  AttestationType,
  AttestationVerdict,
  CertifiedKey,
  CertifyKeyRequest,
  ChallengeRequest,
  ChallengeResponse,
  DeviceVerdict,
  EarStatus,
  EcJwk,
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
  EvidenceBlob,
  ExpectedBinding,
  KeyAlg,
  KeyBlob,
  KeyCertification,
  KeyChallengeRequest,
  KeyChallengeResponse,
  KeyFormat,
  KeyPurpose,
  Platform,
  RequestedDisclosureClass,
  RsaJwk,
  SecureEnclaveEnrollRequestBlob,
  SecureEnclaveKeyCertification,
  TpmEnrollRequestBlob,
  TpmKeyCertification,
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
