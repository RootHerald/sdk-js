/**
 * Compile-time contract assertions (Client ABI 2.0, WP0).
 *
 * Not shipped (excluded from the build `tsconfig.json`; checked by
 * `tsconfig.typecheck.json`). Each sample object is the REAL wire JSON the
 * native client emits / the server binds; `satisfies` fails the typecheck if a
 * contract type drifts from the wire shape. This is the extrinsic signal for
 * WP0 — the types stay grounded in what the code already sends.
 */

import type {
  EnrollActivationChallenge,
  EnrollActivationResponse,
  EnrollRequestBlob,
} from "../src/enroll.js";
import type {
  AlreadyEnrolledResponse,
  RelayActivateRequest,
  RelayActivateResponse,
  RelayEnrollRequest,
  RelayEnrollResponse,
  RelayEnrollResult,
} from "../src/server.js";
import type {
  ChallengeResponse,
  VerifyAttestationRequest,
} from "../src/background-check.js";

// ── EnrollRequestBlob == POST /api/v1/devices/enroll body ──────────────────
// (sdk-native rootherald_win.cpp BuildEnrollFields + server EnrollmentRequest)
const enrollBody = {
  ekPublicKey: "<base64 PCP_EKPUB>",
  akPublicArea: "<base64 TPM2B_PUBLIC>",
  platform: "windows",
  ekCertPem: "-----BEGIN CERTIFICATE-----...",
  ekCertificateChain: ["-----BEGIN CERTIFICATE-----..."],
} satisfies EnrollRequestBlob;

// Firmware-TPM variant: EK cert + chain absent (Intel PTT). Must still satisfy.
const enrollBodyNoCert = {
  ekPublicKey: "<base64>",
  akPublicArea: "<base64>",
  platform: "linux",
} satisfies EnrollRequestBlob;

// ── EnrollActivationChallenge == 201 response of /devices/enroll ───────────
// (server EnrollmentResponse; cpp JsonGet deviceId/credentialBlob/encryptedSecret)
const enrollChallenge = {
  deviceId: "f1a2...uuid",
  credentialBlob: "<base64 MakeCredential id-object>",
  encryptedSecret: "<base64 MakeCredential secret>",
} satisfies EnrollActivationChallenge;

// ── EnrollActivationResponse == POST /api/v1/devices/activate body ─────────
// (server ActivationRequest; cpp activate body {deviceId, decryptedSecret})
const activateBody = {
  deviceId: "f1a2...uuid",
  decryptedSecret: "<base64 32-byte secret>",
} satisfies EnrollActivationResponse;

const activateBodyWithAk = {
  deviceId: "f1a2...uuid",
  decryptedSecret: "<base64>",
  akPublicKey: "<base64 AK pub>", // server ActivationRequest.AkPublicKey (optional)
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

// ── AlreadyEnrolledResponse == 409 body of /devices/enroll (deviceId only) ─
const alreadyEnrolledBody = {
  deviceId: "f1a2...uuid",
} satisfies AlreadyEnrolledResponse;

// ── RelayEnrollResult == normalized relay outcome (discriminated union) ────
// 201 branch: alreadyEnrolled false + full MakeCredential challenge present.
const relayEnrollFresh = {
  alreadyEnrolled: false,
  deviceId: "f1a2...uuid",
  challenge: enrollChallenge,
} satisfies RelayEnrollResult;

// 409 branch: alreadyEnrolled true, deviceId only, NO challenge.
const relayEnrollAlready = {
  alreadyEnrolled: true,
  deviceId: "f1a2...uuid",
} satisfies RelayEnrollResult;

// ── Pre-existing legs still represent the wire (sanity) ────────────────────
const challengeResp = {
  challengeId: "c-123",
  nonce: "<base64 nonce>",
  expiresAt: "2026-06-30T00:05:00Z",
} satisfies ChallengeResponse;

const verifyReq = {
  challengeId: "c-123",
  evidence: { quote: {} } as unknown, // EvidenceBlob is opaque (unknown)
  policy: "rootherald:builtin:strict-hardware",
  returnToken: true,
} satisfies VerifyAttestationRequest;

// Reference the bindings so `noUnusedLocals`-style checks never trip and the
// assertions are not tree-shaken away by lint.
export const __contractAssertions = [
  enrollBody,
  enrollBodyNoCert,
  enrollChallenge,
  activateBody,
  activateBodyWithAk,
  relayEnrollReq,
  relayEnrollResp,
  relayActivateReq,
  relayActivateResp,
  alreadyEnrolledBody,
  relayEnrollFresh,
  relayEnrollAlready,
  challengeResp,
  verifyReq,
] as const;
