/**
 * @rootherald/contracts/server — SERVER-CONTEXT types.
 *
 * These types model the backend (`rh_sk_`) side of the Client ABI 2.0 contract:
 * the four RootHerald calls a customer's backend makes on behalf of its dumb
 * client. They are only ever used from the CUSTOMER's backend (via
 * @rootherald/node or another server SDK), which holds the `rh_sk_` secret key.
 * They are intentionally segregated onto this subpath: a browser/page bundle has
 * no `rh_sk_` secret and never reaches these endpoints, so it should never need
 * to import these. Server code should import them from here:
 *
 *   import { InvalidSecretKeyError } from "@rootherald/contracts/server";
 *
 * For backwards compatibility the error classes are also (deprecated)
 * re-exported from the package root; new server code should prefer this subpath.
 */

export {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "./errors.js";

// ── Backend relay HTTP contract (the four server-SDK helpers) ──────────────
//
// The customer's backend relays the client's opaque blobs to RootHerald with
// its `rh_sk_` secret. The four legs and their request/response shapes:
//
//   relayEnroll(EnrollRequestBlob)        -> EnrollActivationChallenge
//                                            POST /api/v1/attest/enroll
//   relayActivate(EnrollActivationResponse) -> RelayActivateResponse
//                                            POST /api/v1/attest/activate
//   issueChallenge(ChallengeRequest)      -> ChallengeResponse
//                                            POST /api/v1/attest/challenge
//   verify(VerifyAttestationRequest)      -> VerifyAttestationResponse
//                                            POST /api/v1/attest/verify
//
// The challenge/verify pair already lives in `background-check.ts` (re-exported
// below for one-stop server-side import). Only the enroll-relay pair is new; its
// request/response are the client-neutral enroll blobs, named here as the relay
// leg shapes for the server SDKs that mirror this contract.

export type {
  EnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
} from "./enroll.js";

export type {
  ChallengeRequest,
  ChallengeResponse,
  EvidenceBlob,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "./background-check.js";

import type {
  EnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
} from "./enroll.js";

/** Request body of the enroll relay leg — `POST /api/v1/attest/enroll`. */
export type RelayEnrollRequest = EnrollRequestBlob;

/** Response of the enroll relay leg — the MakeCredential challenge. */
export type RelayEnrollResponse = EnrollActivationChallenge;

/**
 * Result of the enroll relay leg. The canonical shape every server SDK returns
 * from its `relayEnroll` helper.
 *
 * Enrolment always issues a challenge, including for a device already known —
 * re-enrolment is how a device rotates its attestation key, so short-circuiting
 * it would make rotation impossible. Relay `challenge` to the client's
 * `EnrollComplete`, then call the activate leg.
 *
 * `deviceId` is **this tenant's alias** for the device, not a global identifier:
 * another tenant enrolling the same silicon is told a different one.
 */
export interface RelayEnrollResult {
  /** This tenant's alias for the device. */
  deviceId: string;
  /** The MakeCredential challenge to relay to the client. */
  challenge: EnrollActivationChallenge;
}

/** Request body of the activate relay leg — `POST /api/v1/attest/activate`. */
export type RelayActivateRequest = EnrollActivationResponse;

/**
 * Response of the activate relay leg — `POST /api/v1/attest/activate`. Mirrors
 * the server's terminal `{ deviceId, status, enrolledAt }` body; the migration
 * contract treats `deviceId` as the load-bearing field.
 */
export interface RelayActivateResponse {
  /** The enrolled device id (UUID). */
  deviceId: string;
  /** Lifecycle status, e.g. `"enrolled"`. */
  status?: string;
  /** ISO 8601 timestamp the device was enrolled. */
  enrolledAt?: string;
}
