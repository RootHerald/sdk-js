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
  CertifiedKey,
  ChallengeRequest,
  ChallengeResponse,
  KeyBlob,
  KeyCertification,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
} from "../src/background-check.js";
import type { AttestationVerdict } from "../src/sdk-api.js";
import { buildMobileAttestLink } from "../src/mobile-bridge.js";
import type {
  BuildMobileAttestLinkOptions,
  MobileAppEnrollRequest,
  MobileAppVerifyRequest,
} from "../src/mobile-bridge.js";

// ── EnrollRequestBlob == POST /api/v1/attest/enroll body, per platform ─────
const enrollBody = {
  ekPublicKey: "<base64 PCP_EKPUB>",
  akPublicArea: "<base64 TPM2B_PUBLIC>",
  platform: "windows",
  ekCertPem: "-----BEGIN CERTIFICATE-----...",
  ekCertificateChain: ["-----BEGIN CERTIFICATE-----..."],
  tpmSelfReport: { manufacturer: "INTC", vendorString: "Intel" },
} satisfies TpmEnrollRequestBlob;

// Firmware-TPM variant: EK cert + chain absent (Intel PTT). Must still satisfy.
const enrollBodyNoCert = {
  ekPublicKey: "<base64>",
  akPublicArea: "<base64>",
  platform: "linux",
} satisfies TpmEnrollRequestBlob;

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

// ── ChallengeRequest == POST /api/v1/attest/challenge body, one per ask ────
// An empty body is today's behaviour: ask defaults to ["identity", "posture"].
const challengeReqDefault = {} satisfies ChallengeRequest;

const challengeReqIdentity = {
  ask: ["identity"],
  deviceHint: "laptop-7",
} satisfies ChallengeRequest;

const challengeReqPosture = {
  ask: ["posture"],
} satisfies ChallengeRequest;

// `keyPurpose` is read only because `ask` contains "key".
const challengeReqKey = {
  ask: ["identity", "posture", "key"],
  keyPurpose: "sign",
} satisfies ChallengeRequest;

// ── ChallengeResponse == 200 of /attest/challenge, with the rhc1 string ────
// `challenge` is `rhc1.<base64url nonce>.<base64url ask-json>`; the second
// segment is `nonce` verbatim (base64url, unpadded), the third is
// {"ask":["identity","posture","key"],"purpose":"sign"} — `purpose` is present
// only when the ask contains "key".
const challengeResp = {
  nonce: "CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY",
  expiresAt: "2026-06-30T00:05:00Z",
  challenge:
    "rhc1.CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY." +
    "eyJhc2siOlsiaWRlbnRpdHkiLCJwb3N0dXJlIiwia2V5Il0sInB1cnBvc2UiOiJzaWduIn0",
} satisfies ChallengeResponse;

// ── Evidence carrying a key certification (documented contents) ────────────
// EvidenceBlob is `unknown` on the wire; the nested object is pinned on its own.
const keyCertification = {
  publicArea: "<base64 TPM2B_PUBLIC of the new P-256 key>",
  attest: "<base64 TPM2B_ATTEST from TPM2_Certify>",
  signature: "<base64 TPMT_SIGNATURE by the AK>",
  purpose: "sign",
} satisfies KeyCertification;

const evidenceWithKey = {
  pcrValues: { sha256: { "7": "<hex>" } },
  quote: { quoted: "<base64 TPMS_ATTEST>", signature: "<base64 TPMT_SIGNATURE>" },
  eventLog: "<base64>",
  keyCertification,
} as unknown; // EvidenceBlob is opaque (unknown)

const verifyReq = {
  nonce: challengeResp.nonce,
  evidence: { quote: {} } as unknown, // EvidenceBlob is opaque (unknown)
} satisfies VerifyAttestationRequest;

const verifyReqWithKey = {
  nonce: challengeResp.nonce,
  evidence: evidenceWithKey,
} satisfies VerifyAttestationRequest;

// ── VerifyAttestationResponse, with and without the key block ──────────────
// The verdict shape is the existing AttestationVerdict; only the fields the
// key samples turn on are spelled out.
const passVerdict = {
  acr: "urn:rootherald:device:high",
  amr: ["hwk"],
  authTime: new Date("2026-06-30T00:01:00Z"),
  expiresAt: new Date("2026-06-30T00:06:00Z"),
  userId: "u-1",
  requestedAcrValues: ["urn:rootherald:device:high"],
  device: {
    ueid: "f1a2...uuid",
    earStatus: "affirming",
    verdict: "pass",
    attestationType: "tpm20",
    attestedAt: new Date("2026-06-30T00:01:00Z"),
  },
  raw: {},
} satisfies AttestationVerdict;

const failVerdict = {
  ...passVerdict,
  device: { ...passVerdict.device, earStatus: "contraindicated", verdict: "fail" },
} satisfies AttestationVerdict;

const certifiedKey = {
  keyId: "k-9f3a",
  jwk: {
    kty: "EC",
    crv: "P-256",
    x: "<base64url x>",
    y: "<base64url y>",
  },
  purpose: "sign",
  certifiedAt: "2026-06-30T00:01:00Z",
} satisfies CertifiedKey;

// Passing verdict on a "key" ask: the key block is present.
const verifyRespWithKey = {
  verdict: passVerdict,
  assuranceClaimsMet: ["device:high"],
  key: certifiedKey,
} satisfies VerifyAttestationResponse;

// Failing verdict on the same "key" ask: no key block, whatever the evidence
// carried. Spelled out as a variable of the declared type so a future
// `key: CertifiedKey` (required) would fail here.
const verifyRespFailedKeyAsk: VerifyAttestationResponse = {
  verdict: failVerdict,
};

// The caller stores the wrapped private key; no SDK parses it.
const keyBlob: KeyBlob = "cmhrMQEA...roughly-300-bytes-of-base64url";

// ── Mobile bridge forwards == what the customer's backend receives ─────────
const mobileEnrollReq = {
  nonce: challengeResp.nonce,
  enrollment: enrollBodyIos,
} satisfies MobileAppEnrollRequest;

const mobileVerifyReq = {
  nonce: challengeResp.nonce,
  evidence: { iosAttestation: { assertion: "<base64 CBOR>", keyId: "<base64 key id>" } },
} satisfies MobileAppVerifyRequest;

// ── Mobile Universal Link == what the companion app parses ────────────────
// The link relays `ChallengeResponse.challenge` verbatim under `challenge`
// and nothing else. The app fails closed on anything else.
const mobileLinkOpts = {
  bridgeBaseUrl: "https://bridge.rootherald.io/",
  challenge: challengeResp.challenge,
} satisfies BuildMobileAttestLinkOptions;
const mobileLink: string = buildMobileAttestLink(mobileLinkOpts);
if (
  mobileLink !==
  "https://bridge.rootherald.io/try/attest?challenge=" +
    encodeURIComponent(challengeResp.challenge)
) {
  throw new Error("buildMobileAttestLink shape drifted");
}

// Reference the bindings so `noUnusedLocals`-style checks never trip and the
// assertions are not tree-shaken away by lint.
export const __contractAssertions = [
  mobileLinkOpts,
  mobileLink,
  mobileEnrollReq,
  mobileVerifyReq,
  enrollBody,
  enrollBodyNoCert,
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
  challengeReqDefault,
  challengeReqIdentity,
  challengeReqPosture,
  challengeReqKey,
  challengeResp,
  keyCertification,
  evidenceWithKey,
  verifyReq,
  verifyReqWithKey,
  verifyRespWithKey,
  verifyRespFailedKeyAsk,
  keyBlob,
] as const;
