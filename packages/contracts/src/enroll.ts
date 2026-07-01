/**
 * Client ABI 2.0 — the enroll handshake blobs (client-neutral).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The three client verbs (language-neutral; the client holds NO RootHerald key
 * and opens NO socket to RootHerald — it only does local TPM work and hands
 * opaque blobs to the embedder, whose backend relays them):
 *
 *   1. Enroll  — `EnrollBegin() -> EnrollRequestBlob`, then
 *                `EnrollComplete(EnrollActivationChallenge) -> EnrollActivationResponse`
 *                (+ `deviceId`, known after leg 1). One-time device-key
 *                bootstrap under a single elevation: gen AK, prove EK→AK via
 *                TPM2_MakeCredential / TPM2_ActivateCredential.
 *   2. Attest  — `Attest(nonce) -> EvidenceBlob` (see `background-check.ts`).
 *                Per-attestation TPM quote over a backend-issued nonce.
 *   3. PreCheck — local readiness signals (TPM reachable? enrolled? Secure Boot
 *                on?). Signals, NEVER a verdict.
 *
 * The blobs below are produced/consumed by the client but never inspected by the
 * SDK transport; the customer's backend relays them to RootHerald with its
 * `rh_sk_` secret key (see the relay pair in `server.ts`). EK cert travels as
 * plaintext PEM for v1 (the opt-in deniability layer is deferred).
 *
 * Field names are canonical: they are exactly the JSON keys the native client
 * already emits (`sdk-native` `rootherald_win.cpp` `BuildEnrollFields`) and the
 * server already binds (`platform` `EnrollmentRequest` / `EnrollmentResponse` /
 * `ActivationRequest`). Pure types; no runtime code.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { Platform } from "./eat.js";

/**
 * `EnrollBegin()` output — the body of `POST /api/v1/devices/enroll`.
 *
 * Mirrors the server `EnrollmentRequest` DTO and the native client's
 * `BuildEnrollFields`. The client gathers the EK material and the freshly
 * created AK public area; the backend relays this verbatim to RootHerald, which
 * validates the EK chain, template-checks the AK, and returns an
 * {@link EnrollActivationChallenge}.
 */
export interface EnrollRequestBlob {
  /**
   * base64 platform-native EK public blob (Windows: NCrypt `PCP_EKPUB`). The
   * stable hardware anchor the deterministic `deviceId` is derived from.
   */
  ekPublicKey: string;
  /**
   * base64 `TPM2B_PUBLIC` of the AK (length-prefixed `TPMT_PUBLIC`, exactly what
   * `TPM2_CreatePrimary` emits) — the server hashes it into the AK Name used by
   * `TPM2_MakeCredential`.
   */
  akPublicArea: string;
  /**
   * Reporting platform. The enroll endpoint accepts the desktop TPM platforms
   * (`"windows" | "linux" | "macos"`) for v1; the wider {@link Platform} union is
   * reused for a single source of truth.
   */
  platform: Platform;
  /**
   * PEM-encoded EK certificate. Optional: firmware TPMs (e.g. Intel PTT) ship no
   * NV-stored EK cert and the manufacturer AIA fallback may be unavailable.
   */
  ekCertPem?: string;
  /**
   * PEM-encoded intermediate CA certs the client recovered from local sources
   * (TPM NV, OS cert stores). Deduplicated by the client (SHA-256 of DER) and
   * capped at 8. Order is not significant; the source is not labeled.
   */
  ekCertificateChain?: string[];
}

/**
 * The MakeCredential challenge — the `201` response body of
 * `POST /api/v1/devices/enroll`, and the input to `EnrollComplete()`.
 *
 * Mirrors the server `EnrollmentResponse` DTO. `credentialBlob` and
 * `encryptedSecret` are the `TPM2_MakeCredential` outputs (already TPM2B-framed);
 * the client feeds them straight into `TPM2_ActivateCredential`.
 *
 * NOTE: a `409 already-enrolled` short-circuit returns only `deviceId` (no
 * credential material). The relay helper handles that case; this type models the
 * normal `201` begin→complete path where all three fields are present.
 */
export interface EnrollActivationChallenge {
  /** The deterministic device id (UUID), derived server-side from the EK. */
  deviceId: string;
  /** base64 `TPM2_MakeCredential` credential blob (`id-object`). */
  credentialBlob: string;
  /** base64 `TPM2_MakeCredential` encrypted secret (`encrypted-secret`). */
  encryptedSecret: string;
}

/**
 * `EnrollComplete()` output — the body of `POST /api/v1/devices/activate`.
 *
 * Mirrors the server `ActivationRequest` DTO. The client decrypts the challenge
 * inside the TPM and returns the released secret to prove EK→AK binding.
 */
export interface EnrollActivationResponse {
  /** The `deviceId` from the {@link EnrollActivationChallenge}. */
  deviceId: string;
  /**
   * base64 of the 32-byte secret released by `TPM2_ActivateCredential` — proof
   * the AK is bound to the attested EK.
   */
  decryptedSecret: string;
  /**
   * Optional base64 AK public area re-sent for the server's anti
   * key-substitution check (server `ActivationRequest.AkPublicKey`). The current
   * Windows client omits it; the server validates it against the
   * credential-activated AK when present.
   */
  akPublicKey?: string;
}
