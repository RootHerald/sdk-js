/**
 * Background-Check (server -> server) wire DTOs.
 *
 * These mirror the frozen RootHerald HTTP contract for the server-side
 * ceremonies a customer's backend drives with its `rh_sk_` secret key:
 *
 *   Attest  — POST /api/v1/attest/challenge  (mint a challenge; the nonce is its handle)
 *             POST /api/v1/attest/verify     (appraise the evidence)
 *   MintKey — POST /api/v1/keys/challenge    (mint a key challenge for a purpose)
 *             POST /api/v1/keys/certify      (register the key the AK certified)
 *
 * The customer's client collects an opaque blob and hands it to the
 * customer's own server; that server calls these endpoints. The verdict
 * reuses the EXISTING `AttestationVerdict` shape (see `sdk-api.ts`).
 *
 * The challenge carries the ask. What the device is being asked to prove is
 * fixed at challenge time, stored on the server's challenge row, and echoed
 * to the client inside the `challenge` string; verify appraises against that
 * stored ask, so a caller cannot widen or weaken it between the two legs.
 *
 * Nothing in a request body locates a row. The server finds the tenant from
 * the `rh_sk_` key, the challenge from the nonce the proof was made over, and
 * the installation from the proof itself.
 *
 * Pure types; no runtime code. These are the shapes the other-language SDKs
 * mirror against, so they are deliberately exact.
 */

import type { AttestationVerdict } from "./sdk-api.js";

/**
 * One thing a challenge asks the device to prove.
 *
 * - `identity` — this is a specific, enrolled installation (quote under its AK).
 * - `posture`  — boot configuration (event log replay, Secure Boot, PCRs).
 *
 * Keys are never asked for here; they have their own ceremony
 * ({@link KeyChallengeRequest}). A `"key"` ask is refused with `400 invalid_ask`.
 */
export type Ask = "identity" | "posture";

/**
 * Request body for `POST /api/v1/attest/challenge`. Policies bind to the
 * API key, so no body names one.
 */
export interface ChallengeRequest {
  /**
   * What the device is asked to prove. Omitted => `["identity", "posture"]`.
   * Bound to the challenge row; the client learns it from
   * {@link ChallengeResponse.challenge}.
   */
  ask?: Ask[];
  /**
   * The `keyId` of a key this tenant certified. The verdict fails with reason
   * `expected_device_mismatch` unless the quote came from the installation
   * that holds that key. Unknown => `422 expected_unknown`.
   */
  expectedKey?: string;
  /**
   * Aliases (`verdict.device.ueid`) this tenant enrolled. The verdict fails
   * with reason `expected_device_mismatch` unless the quote came from one of
   * them. Unknown => `422 expected_unknown`.
   */
  expectedDevices?: string[];
}

/** Response body (200) for `POST /api/v1/attest/challenge`. */
export interface ChallengeResponse {
  /**
   * The backend's handle for this challenge: 32 random bytes, base64url
   * without padding (43 characters). Pass it to verify; the server finds
   * the challenge by it. It is the same bytes as the second segment of
   * {@link challenge}.
   */
  nonce: string;
  /** ISO 8601 timestamp after which the challenge is no longer valid. */
  expiresAt: string;
  /**
   * The string to relay to the client verbatim. Format:
   *
   *   `rhc1.<base64url nonce>.<base64url ask-json>`
   *
   * The third segment decodes to `{"ask":[...]}`.
   *
   * The client parses it to learn the nonce and the ask; nothing else on the
   * customer side needs to. The TPM signs the NONCE ONLY — the ask segment is
   * not covered by the quote. It does not need to be: the ask is bound by the
   * server's challenge row, found by the nonce, and verify appraises against
   * that row, so tampering with the third segment in transit changes what the
   * client collects but not what the server demands.
   */
  challenge: string;
}

/**
 * Opaque device evidence blob. The SDK passes this through to the wire verbatim
 * — it is produced by the collector (the native SDK) and never inspected here.
 *
 * Documented contents, for the server and the native SDKs that agree on them
 * (the type stays `unknown` because no JS SDK reads inside it):
 *
 *   `{ pcrValues, quote, logs?: { srtm?: string }, ekCertPem?, ekCertificateChain? }`
 *
 * `logs` is keyed by log kind; `srtm` is the TCG event log the posture ask
 * needs. The server locates the installation by the signer named inside the
 * signed quote, so the blob carries no device identifier.
 */
export type EvidenceBlob = unknown;

/**
 * How much device detail the caller is asking the appraisal to disclose,
 * from the least-revealing pass/fail token up to the full claim set. Omit to
 * accept the API key's disclosure ceiling (default `pseudonymous`).
 */
export type RequestedDisclosureClass = "verdict" | "pseudonymous" | "derived" | "full";

/** Request body for `POST /api/v1/attest/verify`. */
export interface VerifyAttestationRequest {
  /** The challenge handle returned by the challenge leg ({@link ChallengeResponse.nonce}). */
  nonce: string;
  /** The opaque evidence blob produced by the client collector. */
  evidence: EvidenceBlob;
  /**
   * Optional disclosure ceiling the caller is requesting for this appraisal.
   * Omitted => the API key's ceiling applies (default `pseudonymous`).
   */
  requestedDisclosureClass?: RequestedDisclosureClass;
}

/** Response body (200) for `POST /api/v1/attest/verify`. */
export interface VerifyAttestationResponse {
  /** The appraisal verdict — the EXISTING `AttestationVerdict` shape. */
  verdict: AttestationVerdict;
  /**
   * The assurance claims the device satisfied for the resolved policy (e.g.
   * ACR/AMR-derived capability tags). Use these to gate capabilities on the
   * customer backend. Omitted when the server returns none.
   */
  assuranceClaimsMet?: string[];
  /**
   * `true` when the quote did not resolve to a live installation of this
   * tenant (never enrolled, re-enrolled elsewhere, TPM cleared). The client
   * should enroll and the caller should not trust the verdict.
   */
  enrollmentRequired?: boolean;
}

// ── Blobs the device keeps ─────────────────────────────────────────────────

/**
 * Opaque handle to this installation's wrapped attestation key, returned by
 * `EnrollBegin` and taken back by `EnrollComplete`, `Attest` and `MintKey`.
 * Held by the embedding app, never by RootHerald; no SDK parses it.
 *
 * For the record only: base64url of `rha1` magic + version + parent id +
 * template id + `TPM2B_PUBLIC` + `TPM2B_PRIVATE`. The private half is wrapped
 * by the TPM's storage parent; off that TPM, or after a TPM clear, it fails
 * to load (`KEY_UNLOADABLE`): discard it, enroll, retry once.
 *
 * It is a credential: any process on the device that holds it can attest and
 * mint as this installation.
 */
export type AkBlob = string;

/**
 * Opaque handle to a wrapped app key (sign or decrypt), returned by `MintKey`
 * and taken back by `LoadKey`. Held by the embedding app, never by RootHerald;
 * no SDK parses it.
 *
 * For the record only: base64url of `rhk1` magic + version + parent id +
 * template id + `TPM2B_PUBLIC` + `TPM2B_PRIVATE`. On macOS the blob is an
 * `rhm1` selector for the Secure Enclave key and carries no key material.
 *
 * It is a credential: any process on the device that holds it can use the key.
 */
export type KeyBlob = string;

// ── Ceremony 2: mint a key ─────────────────────────────────────────────────

/**
 * What a minted key is for. One live key per installation per purpose;
 * minting again rotates it under the same `keyId`.
 *
 * `decrypt` keys arrive with wire 8.1; the server refuses the purpose before
 * then.
 */
export type KeyPurpose = "sign" | "decrypt";

/** Request body for `POST /api/v1/keys/challenge`. */
export interface KeyChallengeRequest {
  purpose: KeyPurpose;
  /**
   * Aliases (`verdict.device.ueid`) this tenant enrolled. The certify leg is
   * refused unless the key was certified by one of them. Unknown =>
   * `422 expected_unknown`.
   */
  expectedDevices?: string[];
}

/** Response body (200) for `POST /api/v1/keys/challenge`. */
export interface KeyChallengeResponse {
  /** The backend's handle for this key challenge, as {@link ChallengeResponse.nonce}. */
  nonce: string;
  /**
   * The string to relay to the client verbatim. Format:
   *
   *   `rhk1c.<base64url nonce>.<base64url {"purpose":...}>`
   *
   * The device's `MintKey` reads the nonce and the purpose from it.
   */
  keyChallenge: string;
  /** ISO 8601 timestamp after which the key challenge is no longer valid. */
  expiresAt: string;
}

/**
 * `MintKey` output on a TPM platform. All fields base64.
 *
 * The client creates the key under the TPM's storage parent, then runs
 * `TPM2_Certify` over it with the installation's AK, with the key challenge's
 * nonce as `extraData`. The wrapped private key (the {@link KeyBlob}) never
 * travels to RootHerald — only the public area and the AK's statement about it.
 */
export interface TpmKeyCertification {
  /** `TPM2B_PUBLIC` of the new key. */
  publicArea: string;
  /** `TPM2B_ATTEST` emitted by `TPM2_Certify` (a `TPMS_ATTEST` of type CERTIFY). */
  attest: string;
  /** `TPMT_SIGNATURE` over `attest`, made by the installation's AK. */
  signature: string;
}

/**
 * `MintKey` output on macOS: possession of the Secure Enclave key over the
 * nonce. No new key is created and nothing attests it, so the certified key
 * carries `hardwareBound: false`.
 */
export interface SecureEnclaveKeyCertification {
  platform: "macos";
  /** base64 X9.63 uncompressed P-256 point (65 bytes) of the enclave key. */
  publicKey: string;
  /** base64 ECDSA-P256-SHA256 signature over the fixed prefix ‖ nonce. */
  signature: string;
}

/**
 * `MintKey` output on iOS: an App Attest assertion over the nonce by the
 * enrolled App Attest key. Purpose `sign` only.
 */
export interface AppAttestKeyCertification {
  platform: "ios";
  /** base64 App Attest key id. */
  keyId: string;
  /** base64 CBOR App Attest assertion over the fixed prefix ‖ nonce. */
  assertion: string;
}

/** The device's `MintKey` output, by platform. Relayed verbatim. */
export type KeyCertification =
  | TpmKeyCertification
  | SecureEnclaveKeyCertification
  | AppAttestKeyCertification;

/** Request body for `POST /api/v1/keys/certify`. */
export interface CertifyKeyRequest {
  /** The key challenge handle ({@link KeyChallengeResponse.nonce}). */
  nonce: string;
  /** The device's `MintKey` output, verbatim. */
  certification: KeyCertification;
}

/** JOSE algorithm a certified key is used with; follows from its purpose and type. */
export type KeyAlg = "ES256" | "RS256" | "ECDH-ES" | "RSA-OAEP-256";

/** Envelope format for a decrypt key: JWE compact on TPM platforms, ECIES on macOS. */
export type KeyFormat = "jwe" | "apple-ecies";

/** EC P-256 public key, as a JWK. */
export interface EcJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/** RSA-2048 public key, as a JWK. */
export interface RsaJwk {
  kty: "RSA";
  n: string;
  e: string;
}

/** The public half of a {@link CertifiedKey}. */
export type CertifiedKeyJwk = EcJwk | RsaJwk;

/**
 * Response body (200) for `POST /api/v1/keys/certify`: the key RootHerald
 * registered against the installation that certified it.
 *
 * `keyId` identifies an installation's credential, never a device: bind
 * accounts to `deviceId` (the alias). Minting again for the same purpose
 * rotates the key under the same `keyId`; a re-enrolled installation gets
 * new key IDs.
 */
export interface CertifiedKey {
  /** This tenant's alias for the device that holds the key (`verdict.device.ueid`). */
  deviceId: string;
  /** RootHerald's id for this key. Stable across rotations of the same purpose. */
  keyId: string;
  purpose: KeyPurpose;
  /** `ES256` / `RS256` for a sign key; `ECDH-ES` / `RSA-OAEP-256` for a decrypt key. */
  alg: KeyAlg;
  /** Present for a decrypt key: the envelope `encryptToDevice` must produce. */
  format?: KeyFormat;
  jwk: CertifiedKeyJwk;
  /**
   * `true` when the key lives in a TPM and was certified by the installation's
   * AK; `false` on macOS, where the certification proves possession only.
   */
  hardwareBound: boolean;
  /** ISO 8601 timestamp of the certification. */
  certifiedAt: string;
}
