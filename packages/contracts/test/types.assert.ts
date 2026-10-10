/**
 * Compile-time contract assertions.
 *
 * Not shipped (excluded from the build `tsconfig.json`; checked by
 * `tsconfig.typecheck.json`). Each sample object is the REAL wire JSON the
 * native client emits / the server binds; `satisfies` fails the typecheck if a
 * contract type drifts from the wire shape.
 */

import type {
  AppAttestEnrollRequestBlob,
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
  SecureEnclaveEnrollRequestBlob,
  TpmEnrollRequestBlob,
} from "../src/enroll.js";
import type {
  RelayActivateRequest,
  RelayActivateResponse,
  RelayEnrollRequest,
  RelayEnrollResponse,
  RelayEnrollResult,
} from "../src/server.js";
import type {
  AkBlob,
  CertifiedKey,
  CertifyKeyRequest,
  ChallengeRequest,
  ChallengeResponse,
  KeyBlob,
  KeyCertification,
  KeyChallengeRequest,
  KeyChallengeResponse,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "../src/background-check.js";
import type { AttestationVerdict } from "../src/sdk-api.js";

// ── EnrollRequestBlob == POST /api/v1/attest/enroll body, per platform ─────
const enrollBody = {
  ekPublicKey: "<base64 TPM2B_PUBLIC of the EK>",
  attestationKey: {
    publicArea: "<base64 TPM2B_PUBLIC of the AK>",
    parentPublicArea: "<base64 TPM2B_PUBLIC of the storage parent>",
    qualifiedName: "<base64 TPM2B_NAME>",
  },
  platform: "windows",
  ekCertPem: "-----BEGIN CERTIFICATE-----...",
  ekCertificateChain: ["-----BEGIN CERTIFICATE-----..."],
  tpmSelfReport: { manufacturer: "INTC", vendorString: "Intel" },
} satisfies TpmEnrollRequestBlob;

// Firmware-TPM variant: EK cert + chain absent (Intel PTT). Must still satisfy.
const enrollBodyNoCert = {
  ekPublicKey: "<base64>",
  attestationKey: { publicArea: "<base64>", parentPublicArea: "<base64>", qualifiedName: "<base64>" },
  platform: "linux",
} satisfies TpmEnrollRequestBlob;

// The 7.0 flat TPM body no longer types: the AK is nested in 8.0.
const enrollBodyFlat7 = {
  ekPublicKey: "<base64>",
  akPublicArea: "<base64>",
  platform: "windows",
};
// @ts-expect-error a flat TPM body is a 7.0 shape
const enrollBodyFlat7Refused: TpmEnrollRequestBlob = enrollBodyFlat7;

// macOS stays flat: the enclave key is both EK and AK and has no parent.
const enrollBodyMac = {
  ekPublicKey: "<base64 X9.63 P-256>",
  akPublicArea: "<base64 X9.63 P-256>",
  platform: "macos",
} satisfies SecureEnclaveEnrollRequestBlob;

const enrollBodyIos = {
  platform: "ios",
  iosKeyId: "<base64 key id>",
  iosAttestationObject: "<base64 CBOR>",
  nonce: "CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY",
} satisfies AppAttestEnrollRequestBlob;

const enrollBodies: EnrollRequestBlob[] = [enrollBody, enrollBodyNoCert, enrollBodyMac, enrollBodyIos];

// ── EnrollActivationChallenge == 201 response of /attest/enroll ────────────
const enrollChallenge = {
  enrollmentId: "f1a2...uuid",
  credentialBlob: "<base64 MakeCredential id-object>",
  encryptedSecret: "<base64 MakeCredential secret>",
} satisfies EnrollActivationChallenge;

const enrollChallengeMac = {
  enrollmentId: "f1a2...uuid",
  challengeNonce: "<base64 nonce>",
} satisfies EnrollActivationChallenge;

// iOS has nothing to activate; the 201 is empty.
const enrollChallengeIos = {} satisfies RelayEnrollResponse;

// ── EnrollActivationResponse == POST /api/v1/attest/activate body ─────────
// Unchanged from 7.0: the wrong-parent check moved to leg one (qualifiedName).
const activateBody = {
  enrollmentId: "f1a2...uuid",
  decryptedSecret: "<base64 32-byte secret>",
} satisfies EnrollActivationResponse;

const activateBodyMac = {
  enrollmentId: "f1a2...uuid",
  signature: "<base64 ECDSA>",
} satisfies EnrollActivationResponse;

// ── Relay leg aliases reuse the neutral blobs (server-context names) ───────
const relayEnrollReq: RelayEnrollRequest = enrollBody;
const relayEnrollResp: RelayEnrollResponse = enrollChallenge;
const relayActivateReq: RelayActivateRequest = activateBody;
const relayActivateResp = {
  deviceId: "f1a2...uuid",
  status: "enrolled",
  enrolledAt: "2026-06-30T00:00:00Z",
} satisfies RelayActivateResponse;

// ── RelayEnrollResult == the relay outcome: the 201 body, nothing else ─────
const relayEnrollResult = {
  challenge: enrollChallenge,
} satisfies RelayEnrollResult;

const relayEnrollResultIos = {
  challenge: enrollChallengeIos,
} satisfies RelayEnrollResult;

// The blobs the device keeps; no SDK parses them.
const akBlob: AkBlob = "cmhhMQEB...base64url";
const keyBlob: KeyBlob = "cmhrMQIB...base64url";

// ── ChallengeRequest == POST /api/v1/attest/challenge body ─────────────────
// An empty body: ask defaults to ["identity", "posture"].
const challengeReqDefault = {} satisfies ChallengeRequest;

const challengeReqIdentity = {
  ask: ["identity"],
} satisfies ChallengeRequest;

const challengeReqPosture = {
  ask: ["posture"],
} satisfies ChallengeRequest;

const challengeReqBound = {
  ask: ["identity"],
  expectedKey: "k-9f3a",
  expectedDevices: ["f1a2...uuid"],
} satisfies ChallengeRequest;

// The key ask and keyPurpose left with wire 8.0; keys have their own ceremony.
const challengeReqKey = {
  // @ts-expect-error "key" is not an Ask
  ask: ["identity", "key"],
} satisfies ChallengeRequest;
const challengeReqKeyPurpose = {
  ask: ["identity"],
  // @ts-expect-error keyPurpose is not a challenge field
  keyPurpose: "sign",
} satisfies ChallengeRequest;
const challengeReqDeviceHint = {
  // @ts-expect-error deviceHint is gone
  deviceHint: "laptop-7",
} satisfies ChallengeRequest;

// ── ChallengeResponse == 200 of /attest/challenge, with the rhc1 string ────
// `challenge` is `rhc1.<base64url nonce>.<base64url ask-json>`; the second
// segment is `nonce` verbatim (base64url, unpadded), the third is
// {"ask":["identity","posture"]}.
const challengeResp = {
  nonce: "CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY",
  expiresAt: "2026-06-30T00:05:00Z",
  challenge:
    "rhc1.CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY." +
    "eyJhc2siOlsiaWRlbnRpdHkiLCJwb3N0dXJlIl19",
} satisfies ChallengeResponse;

// ── Evidence (documented contents; opaque on the wire) ─────────────────────
const evidence = {
  pcrValues: { sha256: { "7": "<hex>" } },
  quote: { quoted: "<base64 TPMS_ATTEST>", signature: "<base64 TPMT_SIGNATURE>" },
  logs: { srtm: "<base64 TCG log>" },
} as unknown; // EvidenceBlob is opaque (unknown)

const verifyReq = {
  nonce: challengeResp.nonce,
  evidence,
} satisfies VerifyAttestationRequest;

// ── VerifyAttestationResponse ──────────────────────────────────────────────
// #402: every DeviceVerdictDto field types without a cast; ueid is optional.
const passVerdict = {
  acr: "urn:rootherald:device:high",
  amr: ["hwk"],
  authTime: new Date("2026-06-30T00:01:00Z"),
  expiresAt: new Date("2026-06-30T00:06:00Z"),
  requestedAcrValues: ["urn:rootherald:device:high"],
  device: {
    ueid: "f1a2...uuid",
    disclosureClass: "pseudonymous",
    earStatus: "affirming",
    verdict: "pass",
    attestationType: "tpm20",
    attestedAt: new Date("2026-06-30T00:01:00Z"),
    postureEvaluated: true,
    tpmKind: "firmware-tpm",
    hardwareGenuine: true,
    ekChainTrusted: true,
    sybilResistance: "distinct-silicon-rotatable",
    returningDevice: true,
    identityAgeBucket: "under-90d",
    bootChanged: true,
    bootChangedStages: [7],
    bootChangeAccepted: false,
  },
  expected: { key: "k-9f3a", devices: ["f1a2...uuid"] },
} satisfies AttestationVerdict;

const tpmKind: string | undefined = passVerdict.device.tpmKind;
const bootChangedStages: number[] | undefined = passVerdict.device.bootChangedStages;
const ueid: string | undefined = passVerdict.device.ueid;

// Below pseudonymous: no ueid, no userId.
const verdictOnlyVerdict = {
  acr: "urn:rootherald:device:any",
  amr: ["hwk"],
  authTime: new Date("2026-06-30T00:01:00Z"),
  expiresAt: new Date("2026-06-30T00:06:00Z"),
  requestedAcrValues: [],
  device: {
    disclosureClass: "verdict",
    earStatus: "affirming",
    verdict: "pass",
    attestationType: "tpm20",
    attestedAt: new Date("2026-06-30T00:01:00Z"),
  },
} satisfies AttestationVerdict;

const failVerdict = {
  ...passVerdict,
  device: { ...passVerdict.device, earStatus: "contraindicated", verdict: "fail" },
} satisfies AttestationVerdict;

const verifyResp = {
  verdict: passVerdict,
  assuranceClaimsMet: ["device:high"],
} satisfies VerifyAttestationResponse;

const verifyRespUnenrolled = {
  verdict: failVerdict,
  enrollmentRequired: true,
} satisfies VerifyAttestationResponse;

// The verify response carries no key: keys come from /keys/certify.
const verifyRespWithKey = {
  verdict: passVerdict,
  // @ts-expect-error key is not a verify response field
  key: { keyId: "k-1" },
} satisfies VerifyAttestationResponse;

// ── Mint a key: /keys/challenge + /keys/certify ────────────────────────────
const keyChallengeReq = {
  purpose: "sign",
  expectedDevices: ["f1a2...uuid"],
} satisfies KeyChallengeRequest;

// `keyChallenge` is `rhk1c.<base64url nonce>.<base64url {"purpose":"sign"}>`.
const keyChallengeResp = {
  nonce: "CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY",
  keyChallenge:
    "rhk1c.CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY." +
    "eyJwdXJwb3NlIjoic2lnbiJ9",
  expiresAt: "2026-06-30T00:05:00Z",
} satisfies KeyChallengeResponse;

const tpmCertification = {
  publicArea: "<base64 TPM2B_PUBLIC of the new key>",
  attest: "<base64 TPM2B_ATTEST from TPM2_Certify>",
  signature: "<base64 TPMT_SIGNATURE by the AK>",
} satisfies KeyCertification;

// The purpose comes from the key-challenge row, never from the certification.
const tpmCertificationWithPurpose = {
  ...tpmCertification,
  // @ts-expect-error purpose is not a certification field
  purpose: "sign",
} satisfies KeyCertification;

const macCertification = {
  platform: "macos",
  publicKey: "<base64 X9.63 P-256>",
  signature: "<base64 ECDSA over prefix || nonce>",
} satisfies KeyCertification;

const iosCertification = {
  platform: "ios",
  keyId: "<base64 key id>",
  assertion: "<base64 CBOR assertion>",
} satisfies KeyCertification;

const certifyReq = {
  nonce: keyChallengeResp.nonce,
  certification: tpmCertification,
} satisfies CertifyKeyRequest;

const certifiedEcKey = {
  deviceId: "f1a2...uuid",
  keyId: "k-9f3a",
  purpose: "sign",
  alg: "ES256",
  jwk: { kty: "EC", crv: "P-256", x: "<base64url x>", y: "<base64url y>" },
  hardwareBound: true,
  certifiedAt: "2026-06-30T00:01:00Z",
} satisfies CertifiedKey;

const certifiedRsaKey = {
  deviceId: "f1a2...uuid",
  keyId: "k-1b2c",
  purpose: "sign",
  alg: "RS256",
  jwk: { kty: "RSA", n: "<base64url n>", e: "AQAB" },
  hardwareBound: true,
  certifiedAt: "2026-06-30T00:01:00Z",
} satisfies CertifiedKey;

const certifiedDecryptKey = {
  deviceId: "f1a2...uuid",
  keyId: "k-d3e4",
  purpose: "decrypt",
  alg: "ECDH-ES",
  format: "jwe",
  jwk: { kty: "EC", crv: "P-256", x: "<base64url x>", y: "<base64url y>" },
  hardwareBound: true,
  certifiedAt: "2026-06-30T00:01:00Z",
} satisfies CertifiedKey;

const certifiedMacKey = {
  deviceId: "f1a2...uuid",
  keyId: "k-5f6a",
  purpose: "sign",
  alg: "ES256",
  jwk: { kty: "EC", crv: "P-256", x: "<base64url x>", y: "<base64url y>" },
  hardwareBound: false,
  certifiedAt: "2026-06-30T00:01:00Z",
} satisfies CertifiedKey;

// Reference the bindings so `noUnusedLocals`-style checks never trip and the
// assertions are not tree-shaken away by lint.
export const __contractAssertions = [
  enrollBody,
  enrollBodyNoCert,
  enrollBodyFlat7Refused,
  enrollBodyMac,
  enrollBodyIos,
  enrollBodies,
  enrollChallenge,
  enrollChallengeMac,
  enrollChallengeIos,
  activateBody,
  activateBodyMac,
  relayEnrollReq,
  relayEnrollResp,
  relayActivateReq,
  relayActivateResp,
  relayEnrollResult,
  relayEnrollResultIos,
  akBlob,
  keyBlob,
  challengeReqDefault,
  challengeReqIdentity,
  challengeReqPosture,
  challengeReqBound,
  challengeReqKey,
  challengeReqKeyPurpose,
  challengeReqDeviceHint,
  challengeResp,
  evidence,
  verifyReq,
  passVerdict,
  tpmKind,
  bootChangedStages,
  ueid,
  verdictOnlyVerdict,
  failVerdict,
  verifyResp,
  verifyRespUnenrolled,
  verifyRespWithKey,
  keyChallengeReq,
  keyChallengeResp,
  tpmCertification,
  tpmCertificationWithPurpose,
  macCertification,
  iosCertification,
  certifyReq,
  certifiedEcKey,
  certifiedRsaKey,
  certifiedDecryptKey,
  certifiedMacKey,
] as const;
