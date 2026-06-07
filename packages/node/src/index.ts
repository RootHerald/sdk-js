/**
 * @rootherald/node — Node.js server SDK for RootHerald device attestation.
 *
 * The 80% API is one call:
 *   import { verifyAttestationToken } from "@rootherald/node";
 *   const verdict = await verifyAttestationToken(token, { issuer, audience });
 *
 * For Express-style apps, `requireAttestation` is the gating middleware.
 */

export { verifyAttestationToken } from "./verify.js";
export { requireAttestation } from "./requireAttestation.js";

export {
  InvalidTokenError,
  RootHeraldError,
  TokenExpiredError,
} from "@rootherald/contracts";

export type {
  AcrUrn,
  AmrValue,
  AttestationType,
  AttestationVerdict,
  DeviceVerdict,
  EarStatus,
  Platform,
  RequireAttestationMiddlewareOptions,
  TrustworthinessVector,
  Verdict,
  VerifyOptions,
} from "@rootherald/contracts";
