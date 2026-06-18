/**
 * @rootherald/node — Node.js server SDK for RootHerald device attestation.
 *
 * The 80% API is one call:
 *   import { verifyAttestationToken } from "@rootherald/node";
 *   const verdict = await verifyAttestationToken(token, { issuer, audience });
 *
 * For Express-style apps, `requireAttestation` is the gating middleware.
 *
 * For the server -> server Background-Check flow (the customer's server appraises
 * a client-collected evidence blob with its `rh_sk_` secret key), use the
 * `RootHerald` client:
 *   const rh = new RootHerald({ secretKey: process.env.RH_SECRET_KEY! });
 *   const { challengeId, nonce } = await rh.createChallenge();
 *   const verdict = await rh.attest(evidence, { challengeId });
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
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  InvalidTokenError,
  QuotaExceededError,
  RootHeraldApiError,
  RootHeraldError,
  TokenExpiredError,
  UnknownPolicyError,
} from "@rootherald/contracts";

export type {
  AcrUrn,
  AmrValue,
  AttestationType,
  AttestationVerdict,
  ChallengeRequest,
  ChallengeResponse,
  DeviceVerdict,
  EarStatus,
  EvidenceBlob,
  Platform,
  RequireAttestationMiddlewareOptions,
  TrustworthinessVector,
  Verdict,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
  VerifyOptions,
} from "@rootherald/contracts";
