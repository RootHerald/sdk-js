# Changelog

All notable changes to `@rootherald/node` are documented here.

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
