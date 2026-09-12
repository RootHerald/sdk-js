# Changelog

All notable changes to `@rootherald/node` are documented here.

## 0.1.0-alpha.18

Wire 7.0. Nothing a client sends locates a row: the server resolves the
tenant from the key, the challenge from the nonce the proof was made over,
the enrollment from the `enrollmentId` it minted, and the device from the
proof itself. A backend on this version cannot drive a 6.0 client, and the
reverse.

### Breaking

- `issueChallenge` returns `{ nonce, challenge, expiresAt }`. `challengeId`
  is gone; `nonce` (base64url, unpadded, the second segment of `challenge`)
  is the handle. `verify(evidence, { nonce })` takes it; a missing one is
  `MISSING_NONCE`. `VerifyAttestationRequest` carries `nonce`, not
  `challengeId`.
- `relayEnroll(blob)` takes no options and sends no query string. It returns
  `{ challenge }` only — the 201 body, relayed to the device verbatim — with
  no `deviceId`. The 201 is `{ enrollmentId, credentialBlob, encryptedSecret }`
  (TPM), `{ enrollmentId, challengeNonce }` (macOS), or `{}` (iOS).
  `RelayEnrollOptions` is removed.
- `relayActivate(blob)` requires `enrollmentId` and one of `decryptedSecret`
  or `signature`. `deviceId`, `challengeId` and `akPublicKey` are gone from
  the activation body. The response `{ deviceId, status?, enrolledAt? }` is
  unchanged; it stays on the backend and is never relayed to the device.
- `EnrollRequestBlob` is a union discriminated by `platform`:
  `TpmEnrollRequestBlob` (with optional `tpmSelfReport`, no
  `firmwareVersion`), `SecureEnclaveEnrollRequestBlob`, and
  `AppAttestEnrollRequestBlob` (`{ platform: "ios", iosKeyId,
  iosAttestationObject, nonce }`).
- `verifyMobileEvidence(body)` requires `body.nonce` and
  `evidence.iosAttestation.{assertion,keyId}`; an `attestationObject` at
  verify is refused. `MobileAppVerifyRequest` matches.
- `buildMobileAttestLink({ bridgeBaseUrl, challenge })` renders
  `<base>/try/attest?challenge=`; the `tenant` and `challengeId` inputs are
  gone. The bridge reopens the page with `?nonce=` (was `?rhcid=`).

### Added

- `MobileAppEnrollRequest { nonce, enrollment }`, the body the bridge forwards
  to a registered enroll URL; hand `enrollment` to `relayEnroll`.
- `RelayEnrollResponse`, the enroll 201 body including the empty iOS form.

## 0.1.0-alpha.17

### Breaking

- Policies bind to API keys. The `policy` option is gone from
  `issueChallenge`, `verify` and `verifyMobileEvidence`, and the `policy`
  field from `ChallengeRequest` and `VerifyAttestationRequest`. The server
  refuses the field with `400 policy_bound_to_key`. Bind a policy to the key
  from the dashboard or `PUT /api/v1/admin/api-keys/{id}/policies`.
- `PolicyDowngradeError` is removed with the field that produced it.
  `UnknownPolicyError` (422 `unknown_policy`) now means a policy bound to the
  key no longer exists.

## 0.1.0-alpha.16

### Breaking

- `buildMobileAttestLink` takes `challenge` (the `ChallengeResponse.challenge`
  string, relayed verbatim) instead of `nonce`, and the Universal Link carries
  it as `?challenge=`. The `nonce` query parameter was a holdover from links
  minted before the challenge carried the ask; the companion app now rejects a
  link without an `rhc1.` challenge, so a bare nonce is no longer accepted
  anywhere on the mobile path.

## 0.1.0-alpha.15

The challenge carries the ask. What the device is asked to prove is fixed at
`issueChallenge`, bound to the challenge server-side, and appraised against at
`verify`.

### Added

- `issueChallenge` options `ask` (`Ask[]`), `policy`, and `keyPurpose`; the
  response now includes the `challenge` string to relay to the client
  verbatim. Omitting `ask` behaves as before (`["identity", "posture"]`).
- `verify` results carry `key` when the challenge asked for `"key"` and the
  verdict passed: `{ keyId, jwk, purpose, authPolicy?, certifiedAt }`, with
  `certifiedAt` parsed to a `Date` like the verdict's own timestamps.
- `verifyKeySignature(jwk, message, signature)` checks an ES256 signature
  from a certified key with `node:crypto` only. Message as bytes or UTF-8
  string; signature as bytes or base64url; P1363 or DER. Returns `false`,
  never throws, on malformed input.
- `relayEnroll(blob, { challengeId })` runs admission against the policy bound
  to that challenge. Refusal is `AdmissionRefusedError` (422
  `admission_refused`), with the server's detail as the message.
- `PolicyDowngradeError` (422 `policy_downgrade`): `verify` named a weaker
  policy than the challenge's. A 422 without either code is still
  `UnknownPolicyError`.
- Re-exports `Ask`, `CertifiedKey`, `KeyBlob`, `KeyCertification`,
  `RequestedDisclosureClass`, and the mobile-bridge types and
  `buildMobileAttestLink`, so nothing needs a direct `@rootherald/contracts`
  import.

### Fixed

- The README described `/devices/*` routes, an `alreadyEnrolled` branch, and
  `createChallenge`/`attest` aliases, none of which exist. It now documents
  the real API and the three flows: identity binding, posture step-up, key
  issuance with local verification.

## Unreleased (0.1.0-alpha.14 and earlier)

### Breaking

- `RootHerald` is now `RootHeraldClient`. The class name has to carry the
  product because an import flattens it — `import { RootHerald }` gave no hint
  which library it came from. The other server SDKs make the same change, so the
  type has one name everywhere it is spelled out and is simply `Client` where a
  namespace already supplies the product (`rootherald.Client`,
  `RootHerald::Client`, `Rootherald\Client`).
- `createChallenge` and `attest` are removed. They were aliases from the ABI 2.0
  rename; use `issueChallenge` and `verify`. Both spellings posted to the same
  endpoint with the same body, so nothing on the wire changes.
- `CreateChallengeOptions` is now `IssueChallengeOptions`, matching the method it
  belongs to.
- `@rootherald/browser` drops `collectEvidence` and `CollectOptions`; use
  `attest` and `AttestOptions`.

### Note on the entries below

`requireAttestation` and `verifyAttestationToken` **no longer exist**. They were
part of the offline / portable-token surface (verify a signed EAT locally against
a public JWKS), which was removed when the SDK moved to the Background-Check
model: your backend calls `verify` server-to-server and gets a verdict back, so
there is no token for the SDK to check.

The 0.1.0-alpha.7 entry is left in place because a changelog is a historical
record, but it describes an API this package has not shipped for some time — and
because `CHANGELOG.md` is in `files`, it goes out in the npm tarball, where a
reader would otherwise go looking for functions that are not there. Its closing
claim that "all other option names and function signatures are stable" has not
been true since that surface was removed.

The current API is documented in `README.md`.

## 0.1.0-alpha.7

### Security (breaking behavior change)

- **Fix ACR cross-track bypass in `requireAttestation`.** `requireAttestation`
  now enforces the device and user ACR tracks **separately**, as specified by
  the Root Herald ACR Value Registry ("Hierarchy and Subsumption" — the
  device-only and user tiers are separate tracks). Previously a single flattened
  ACR ladder allowed a pure user-auth token (e.g. `urn:rootherald:user:1fa`) to
  wrongly satisfy a device requirement (e.g. `urn:rootherald:device:high`).

  Tokens that previously satisfied a `device:*` requirement via a user-track ACR
  are now **correctly rejected** with the RFC 9470 step-up `401` challenge. In
  addition, a `device:high` requirement is now satisfied only when the verdict
  carries the required device evidence (`quoteVerified && secureBootVerified &&
  eventLogVerified`) — the `acr` claim string alone is no longer sufficient.

  This is a **breaking behavior change** for anyone who (knowingly or not) relied
  on the old, buggy acceptance where a user-track token passed a device gate.
  Same-track laddering is unchanged: `device:high` still satisfies a `device:any`
  requirement, and a higher user tier still satisfies a lower user requirement.

  No public API surface changed — `acrValues`, `maxAgeSeconds`, and all other
  option names and function signatures are stable. Only the satisfaction logic
  changed.
