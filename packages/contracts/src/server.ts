/**
 * @rootherald/contracts/server — SERVER-CONTEXT types.
 *
 * These types model the backend (`rh_sk_`) side of the client contract: the
 * four RootHerald calls a customer's backend makes on behalf of its dumb
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
  ActivationRefusedError,
  AdmissionRefusedError,
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "./errors.js";

// ── Backend relay HTTP contract (the four server-SDK helpers) ──────────────
//
// The customer's backend relays the client's opaque blobs to RootHerald with
// its `rh_sk_` secret. The four legs and their request/response shapes:
//
//   relayEnroll(RelayEnrollRequest)         -> RelayEnrollResult
//                                              POST /api/v1/attest/enroll
//   relayActivate(EnrollActivationResponse) -> RelayActivateResponse
//                                              POST /api/v1/attest/activate
//   issueChallenge(ChallengeRequest)        -> ChallengeResponse
//                                              POST /api/v1/attest/challenge
//   verify(VerifyAttestationRequest)        -> VerifyAttestationResponse
//                                              POST /api/v1/attest/verify
//
// The challenge/verify pair lives in `background-check.ts` (re-exported below
// for one-stop server-side import). The enroll-relay pair's request/response
// are the client-neutral enroll blobs, named here as the relay leg shapes for
// the server SDKs that mirror this contract.

export type {
  AppAttestEnrollRequestBlob,
  EnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
  SecureEnclaveEnrollRequestBlob,
  TpmEnrollRequestBlob,
} from "./enroll.js";

export type {
  Ask,
  CertifiedKey,
  ChallengeRequest,
  ChallengeResponse,
  EvidenceBlob,
  KeyBlob,
  KeyCertification,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "./background-check.js";

import type {
  EnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
} from "./enroll.js";

/**
 * Request body of the enroll relay leg — `POST /api/v1/attest/enroll`. The
 * client's {@link EnrollRequestBlob}, relayed verbatim; the backend adds
 * nothing. Admission runs under the identity policy bound to the API key;
 * refusal is `422 admission_refused` with the TPM class in the detail (see
 * {@link AdmissionRefusedError}).
 */
export type RelayEnrollRequest = EnrollRequestBlob;

/**
 * Response (201) of the enroll relay leg: the activation challenge, or `{}`
 * for an iOS enrollment, which has nothing to activate.
 */
export type RelayEnrollResponse = EnrollActivationChallenge | Record<string, never>;

/**
 * Result of the enroll relay leg. The canonical shape every server SDK returns
 * from its `relayEnroll` helper.
 *
 * Enrollment always issues a challenge, including for a device already known —
 * re-enrollment is how a device rotates its attestation key, so short-circuiting
 * it would make rotation impossible. Relay `challenge` to the client's
 * `EnrollComplete`, then call the activate leg. The backend learns the
 * device's alias from {@link RelayActivateResponse.deviceId}, not here.
 */
export interface RelayEnrollResult {
  /** The 201 body to relay to the client. */
  challenge: RelayEnrollResponse;
}

/** Request body of the activate relay leg — `POST /api/v1/attest/activate`. */
export type RelayActivateRequest = EnrollActivationResponse;

/**
 * Response of the activate relay leg — `POST /api/v1/attest/activate`. Mirrors
 * the server's terminal `{ deviceId, status, enrolledAt }` body; `deviceId` is
 * the load-bearing field.
 *
 * `deviceId` is **this tenant's alias** for the device, not a global
 * identifier: another tenant enrolling the same silicon is told a different
 * one. It goes to the backend and must never be relayed to the device.
 */
export interface RelayActivateResponse {
  /** This tenant's alias for the enrolled device (UUID). */
  deviceId: string;
  /** Lifecycle status, e.g. `"enrolled"`. */
  status?: string;
  /** ISO 8601 timestamp the device was enrolled. */
  enrolledAt?: string;
}
