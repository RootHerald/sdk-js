/**
 * @rootherald/node — Node.js server SDK for RootHerald device attestation.
 *
 * The 80% API is one call:
 *   import { verifyAttestationToken } from "@rootherald/node";
 *   const verdict = await verifyAttestationToken(token, { issuer, audience });
 *
 * For Express-style apps, `requireAttestation` is the gating middleware.
 *
 * For the server -> server attestation flow (the customer's server relays a
 * client-collected opaque blob to RootHerald with its `rh_sk_` secret key), use
 * the `RootHerald` client:
 *   const rh = new RootHerald({ secretKey: process.env.RH_SECRET_KEY! });
 *   const { challengeId, nonce } = await rh.issueChallenge();
 *   const verdict = await rh.verify(evidence, { challengeId });
 *
 * Device enrollment is a two-leg, backend-relayed handshake (the client holds no
 * key and never reaches RootHerald):
 *   const r = await rh.relayEnroll(enrollRequestBlob);        // POST /devices/enroll
 *   if (!r.alreadyEnrolled) {                                 // 201 → run leg 2
 *     // hand r.challenge to the client's EnrollComplete, then:
 *     await rh.relayActivate(activationResponse);             // POST /devices/activate
 *   }                                                         // 409 → already bound, skip
 */

export { verifyAttestationToken } from "./verify.js";
export { requireAttestation } from "./requireAttestation.js";
export { RootHerald } from "./client.js";

export type {
  AttestOptions,
  AttestResult,
  CreateChallengeOptions,
  RootHeraldClientOptions,
} from "./client.js";

export {
  InvalidTokenError,
  RootHeraldError,
  TokenExpiredError,
} from "@rootherald/contracts";
export {
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
  AttestationType,
  AttestationVerdict,
  ChallengeRequest,
  ChallengeResponse,
  DeviceVerdict,
  EarStatus,
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
  EvidenceBlob,
  Platform,
  RequireAttestationMiddlewareOptions,
  TrustworthinessVector,
  Verdict,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
  VerifyOptions,
} from "@rootherald/contracts";

// The enroll-relay result union and activate-leg terminal response shape are
// canonical on the server subpath (server SDKs mirror one shape).
export type {
  RelayActivateResponse,
  RelayEnrollResult,
} from "@rootherald/contracts/server";
