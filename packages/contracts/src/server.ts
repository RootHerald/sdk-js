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
//                                            POST /api/v1/devices/enroll
//   relayActivate(EnrollActivationResponse) -> RelayActivateResponse
//                                            POST /api/v1/devices/activate
//   issueChallenge(ChallengeRequest)      -> ChallengeResponse
//                                            POST /api/v1/attestations/challenge
//   verify(VerifyAttestationRequest)      -> VerifyAttestationResponse
//                                            POST /api/v1/attestations/verify
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

/** Request body of the enroll relay leg — `POST /api/v1/devices/enroll`. */
export type RelayEnrollRequest = EnrollRequestBlob;

/** Response of the enroll relay leg — the MakeCredential challenge. */
export type RelayEnrollResponse = EnrollActivationChallenge;

/**
 * The `409 already-enrolled` response body of `POST /api/v1/devices/enroll`.
 *
 * The enroll endpoint is asymmetric: a fresh enroll returns the full
 * {@link RelayEnrollResponse} ({@link EnrollActivationChallenge}) with a `201`,
 * but a device that is already bound short-circuits with a `409` carrying ONLY
 * `deviceId` (no credential material). This models that 409 body. The server
 * SDKs (Go/Java/Ruby/PHP/.NET) mirror this one shape.
 */
export interface AlreadyEnrolledResponse {
  /** The already-enrolled device id (UUID). */
  deviceId: string;
}

/**
 * Resolved result of the enroll relay leg, normalizing the asymmetric
 * `201`/`409` HTTP outcomes into one discriminated union so callers branch on
 * `alreadyEnrolled` instead of re-parsing HTTP status. This is the canonical
 * shape every server SDK returns from its `relayEnroll` helper.
 *
 *   - **`alreadyEnrolled: false`** — fresh `201` enroll: `challenge` (the full
 *     {@link EnrollActivationChallenge}) is present; relay it to the client's
 *     `EnrollComplete`, then call the activate leg.
 *   - **`alreadyEnrolled: true`** — `409` short-circuit (see
 *     {@link AlreadyEnrolledResponse}): the device is already bound, so SKIP the
 *     activate leg and just use `deviceId`. No `challenge`.
 *
 * Either way `deviceId` is resolved.
 */
export type RelayEnrollResult =
  | { alreadyEnrolled: false; deviceId: string; challenge: EnrollActivationChallenge }
  | { alreadyEnrolled: true; deviceId: string };

/** Request body of the activate relay leg — `POST /api/v1/devices/activate`. */
export type RelayActivateRequest = EnrollActivationResponse;

/**
 * Response of the activate relay leg — `POST /api/v1/devices/activate`. Mirrors
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
