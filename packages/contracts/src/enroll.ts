/**
 * The enroll handshake blobs (client-neutral), Client ABI 8.0.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * The client verbs (language-neutral; the client holds NO RootHerald key and
 * opens NO socket to RootHerald — it only does local TPM work and hands opaque
 * blobs to the embedder, whose backend relays them):
 *
 *   Open / Close     — acquire and release the TPM session every other verb
 *                      runs inside.
 *   PreCheck         — local readiness signals (TPM reachable? which AK
 *                      families it supports?). Signals, NEVER a verdict.
 *   EnrollBegin      — `-> EnrollRequestBlob + AkBlob`. Creates this
 *                      installation's attestation key under the TPM's storage
 *                      parent and hands it back wrapped (`rha1`). Then
 *   EnrollComplete   — `(EnrollActivationChallenge, AkBlob) -> EnrollActivationResponse`.
 *                      Proves EK→AK via TPM2_MakeCredential /
 *                      TPM2_ActivateCredential. Windows needs one elevation
 *                      per enrollment, here.
 *   Attest           — `(challenge, AkBlob) -> EvidenceBlob` (see `background-check.ts`).
 *                      Takes the `rhc1.` challenge string verbatim and quotes
 *                      what its ask says under the AK. Evidence only.
 *   MintKey          — `(keyChallenge, AkBlob) -> KeyCertification + KeyBlob`.
 *                      Creates a new key and has the AK certify it over the
 *                      `rhk1c.` key challenge's nonce.
 *   LoadKey / KeyInfo / Sign / CloseKey / CheckKey
 *                    — load a `KeyBlob` back into the TPM, read its purpose
 *                      and algorithm, sign with it, and release it. The
 *                      private half never leaves the TPM.
 *
 * The SDK stores nothing: the embedding app keeps the AK blob and every key
 * blob, and passes the AK blob to every Attest and MintKey.
 *
 * The blobs below are produced/consumed by the client but never inspected by the
 * SDK transport; the customer's backend relays them to RootHerald with its
 * `rh_sk_` secret key (see the relay pair in `server.ts`). EK cert travels as
 * plaintext PEM for v1 (the opt-in deniability layer is deferred).
 *
 * No identifier the server assigns reaches the device. Enrollment is keyed by
 * the `enrollmentId` the server mints on leg 1 and spends on leg 2; the
 * backend learns the device's alias from activation and from verdicts, never
 * from a relayed body.
 *
 * Field names are canonical: they are exactly the JSON keys the native clients
 * emit and the server binds (`platform` `EnrollmentRequest` /
 * `EnrollmentResponse` / `ActivationRequest`). Pure types; no runtime code.
 * ──────────────────────────────────────────────────────────────────────────
 */

/**
 * The per-installation attestation key, as `EnrollBegin()` describes it to
 * the server. All three fields base64.
 *
 * The server recomputes the qualified name from the two public areas and
 * refuses the enrollment (`400 invalid_enroll_shape`) when it differs from
 * `qualifiedName`, so a key created under the wrong parent fails before any
 * elevation prompt and before any row is written.
 */
export interface AttestationKeyPublic {
  /** `TPM2B_PUBLIC` of the AK, as `TPM2_Create` emitted it. */
  publicArea: string;
  /** `TPM2B_PUBLIC` of the storage parent the AK was created under. */
  parentPublicArea: string;
  /** `TPM2B_NAME` qualified name of the AK, as `TPM2_ReadPublic` returned it. */
  qualifiedName: string;
}

/**
 * `EnrollBegin()` output on a TPM 2.0 platform — the body of
 * `POST /api/v1/attest/enroll`. The server validates the EK chain,
 * template-checks the AK against its approved set, and returns an
 * {@link EnrollActivationChallenge}.
 *
 * The nested `attestationKey` is what tells an 8.0 body from a 7.0 one; a
 * flat body with a top-level `akPublicArea` is refused with
 * `400 wire_version_unsupported`.
 */
export interface TpmEnrollRequestBlob {
  /** base64 `TPM2B_PUBLIC` of the endorsement key. */
  ekPublicKey: string;
  /** This installation's attestation key and its parent. */
  attestationKey: AttestationKeyPublic;
  platform: "windows" | "linux";
  /**
   * PEM-encoded EK certificate. Optional: firmware TPMs (e.g. Intel PTT) ship no
   * NV-stored EK cert; the server then fetches the vendor certificate itself.
   */
  ekCertPem?: string;
  /**
   * PEM-encoded intermediate CA certs the client recovered from local sources
   * (TPM NV, OS cert stores). Deduplicated by the client (SHA-256 of DER) and
   * capped at 8. Order is not significant; the source is not labeled.
   */
  ekCertificateChain?: string[];
  /**
   * The TPM's own, unsigned answer to `TPM2_GetCapability`. The server reads it
   * only downward — to recognise a software TPM that presents no EK
   * certificate — never to promote a device.
   */
  tpmSelfReport?: {
    manufacturer: string;
    vendorString: string;
  };
}

/**
 * `EnrollBegin()` output on macOS. The Secure Enclave key stands in for both
 * the EK and the AK: `ekPublicKey` and `akPublicArea` carry the SAME key
 * (X9.63 uncompressed, 65 bytes, base64). There is no EK certificate and no
 * parent, so the body stays flat; it is never refused for its shape.
 */
export interface SecureEnclaveEnrollRequestBlob {
  ekPublicKey: string;
  akPublicArea: string;
  platform: "macos";
}

/**
 * The iOS enroll body. One leg: Apple's attestation object carries the
 * certificate chain, the attested key and the challenge binding, so there is
 * nothing to activate and the 201 is `{}`.
 */
export interface AppAttestEnrollRequestBlob {
  platform: "ios";
  /** base64 App Attest key id. */
  iosKeyId: string;
  /** base64 CBOR App Attest attestation object. */
  iosAttestationObject: string;
  /**
   * The challenge handle the attestation was made over: the second segment
   * of the `rhc1.` challenge string, verbatim (base64url, unpadded). The
   * server finds the challenge by it and spends it.
   */
  nonce: string;
}

/**
 * `EnrollBegin()` output — the body of `POST /api/v1/attest/enroll`,
 * discriminated by `platform`. The backend relays it verbatim, whichever
 * shape it is.
 */
export type EnrollRequestBlob =
  | TpmEnrollRequestBlob
  | SecureEnclaveEnrollRequestBlob
  | AppAttestEnrollRequestBlob;

/**
 * The `201` response body of `POST /api/v1/attest/enroll`, and the input to
 * `EnrollComplete()`. Relayed to the device verbatim.
 *
 * TPM: `credentialBlob` and `encryptedSecret` are the `TPM2_MakeCredential`
 * outputs (already TPM2B-framed); the client feeds them straight into
 * `TPM2_ActivateCredential`. macOS: `challengeNonce` is the nonce the enclave
 * key signs. iOS enrollment returns `{}` instead (see
 * {@link import('./server.js').RelayEnrollResponse}).
 *
 * Every enroll returns a challenge, including for a device already known.
 * Each activation creates a new installation with a new AK blob; the alias
 * does not change.
 */
export interface EnrollActivationChallenge {
  /**
   * The server's handle for this open enrollment (UUID). Echoed back in the
   * {@link EnrollActivationResponse}; spent by activation.
   */
  enrollmentId: string;
  /** base64 `TPM2_MakeCredential` credential blob (`id-object`). Windows/Linux. */
  credentialBlob?: string;
  /** base64 `TPM2_MakeCredential` encrypted secret (`encrypted-secret`). Windows/Linux. */
  encryptedSecret?: string;
  /** base64 nonce for the enclave key to sign. macOS. */
  challengeNonce?: string;
}

/**
 * `EnrollComplete()` output — the body of `POST /api/v1/attest/activate`.
 *
 * Mirrors the server `ActivationRequest` DTO. The proof is per platform: a
 * TPM returns the secret it released inside `TPM2_ActivateCredential`; a
 * Secure Enclave returns a signature over `challengeNonce`.
 */
export interface EnrollActivationResponse {
  /** The `enrollmentId` from the {@link EnrollActivationChallenge}. */
  enrollmentId: string;
  /**
   * base64 of the 32-byte secret released by `TPM2_ActivateCredential` — proof
   * the AK is bound to the attested EK. Windows/Linux.
   */
  decryptedSecret?: string;
  /**
   * base64 ECDSA-P256-SHA256 signature over `challengeNonce`, DER or
   * IEEE-P1363. macOS.
   */
  signature?: string;
}
