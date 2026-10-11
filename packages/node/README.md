# @rootherald/node

Server-side SDK for RootHerald device attestation.

Wire 8.0 from `0.1.0-alpha.20`. A 7.0 client cannot enroll against an 8.0
server; see the [CHANGELOG](./CHANGELOG.md) for the migration.

**Backend relay (server -> server).** The user's client does local TPM work and
hands your server opaque blobs (no keys, no RootHerald contact). Your server
relays those blobs to RootHerald with `RootHeraldClient`, authenticated by your
`rh_sk_` secret key. The verdict is computed by RootHerald and returned to *your
backend*; it never travels through the client.

**Three ceremonies, two calls each.**

- `rh.relayEnroll(enrollRequestBlob)` / `rh.relayActivate(activationResponse)`:
  enroll an installation (`POST /api/v1/attest/enroll`, `/activate`).
- `rh.issueKeyChallenge({ purpose, expectedDevices? })` /
  `rh.certifyKey(nonce, certification)`: mint a device-bound key
  (`POST /api/v1/keys/challenge`, `/certify`).
- `rh.issueChallenge({ ask?, expectedKey?, expectedDevices? })` /
  `rh.verify(evidence, { nonce, requestedDisclosureClass?, expectedKey?, expectedDevices? })`:
  attest (`POST /api/v1/attest/challenge`, `/verify`).
- `verifyKeySignature(jwk, message, signature)`: check a signature from a
  certified key locally, with `node:crypto` only.

**The challenge carries the ask.** What the device is asked to prove is fixed
when you issue the challenge, bound to it server-side, and echoed to the client
inside the `challenge` string. `verify` appraises against that stored ask, so
nothing between the two calls can widen or weaken it.

## Install

```
pnpm add @rootherald/node
```

`secretKey` is **required** and must start with `rh_sk_`; any other value is
rejected. `baseUrl` defaults to the production RootHerald API and must be
`https` (loopback excepted). Network calls use the built-in `fetch` (Node 18+).
The package has no runtime dependencies beyond `@rootherald/contracts`, which
is types only.

## Enroll an installation

Each installation of your client enrolls once. The client's `EnrollBegin`
creates an attestation key (AK) inside the TPM and returns an opaque AK blob
alongside the enroll body; the client keeps the blob and passes it to every
later attest and mint. Windows needs one elevation per enrollment.

```ts
import { RootHeraldClient } from '@rootherald/node';

const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! }); // rh_sk_…

// Leg 1: relay the client's EnrollBegin() body verbatim. Admission runs under
// the key's identity policy, so a device that could never satisfy it is
// refused before it gets an attestation key.
const { challenge } = await rh.relayEnroll(enrollRequestBlob);

// Hand `challenge` (the 201 body) to the client's EnrollComplete(), which
// returns an activationResponse; relay it to finish binding.
const { deviceId } = await rh.relayActivate(activationResponse);
// deviceId is this tenant's alias for the device. Keep it here; do not send
// it back to the client.
```

The alias is the device's only identity: a new AK, a new key, a re-enrollment
or a TPM clear never changes it. Bind accounts to it. An iOS enrollment has
nothing to activate: its `challenge` is `{}` and there is no second leg.

When to enroll:

- The client has no AK blob: enroll first.
- The client's attest or mint reports the AK blob unloadable (TPM cleared,
  parent changed): discard the blob, enroll, retry once.
- `verify` answers `enrollmentRequired: true`: enroll.

## Attest

```ts
// 1. Mint a challenge. Relay `challenge` to the client; keep `nonce`.
const { nonce, challenge } = await rh.issueChallenge({ ask: ['identity'] });

// 2. The client's Attest answers with an opaque `evidence` blob. Appraise it.
const result = await rh.verify(evidence, { nonce });

if (result.device.verdict === 'pass') {
  // result.device.ueid is the alias: bind the session to it.
}
```

Omitting `ask` asks for `['identity', 'posture']`. A posture ask runs under
the key's posture policy and checks the boot configuration; use it for
step-up, with `result.assuranceClaimsMet` listing the policy claims the device
satisfied.

**Name the device that must answer.** `expectedDevices` takes aliases you
enrolled, `expectedKey` a `keyId` you certified; any other device answers a
failing verdict with reason `expected_device_mismatch`, and an unknown value is
`422 expected_unknown`. Pass the same values to `verify`: the verdict echoes
what the server enforced under `expected`, and `verify` refuses a verdict that
does not echo it (`EXPECTED_NOT_ENFORCED`).

```ts
const { nonce, challenge } = await rh.issueChallenge({
  ask: ['identity'],
  expectedDevices: [session.deviceId],
});
const result = await rh.verify(evidence, { nonce, expectedDevices: [session.deviceId] });
```

Policies bind to your API key, not to calls. Change what a key enforces from
the dashboard; a `policy` field in a hand-built request body is refused with
`400 policy_bound_to_key`.

## Device-bound signing keys

A key is created inside the chip and certified by the installation's AK; you
get its public half, the device keeps the blob. A signature on a request then
proves the request came from that device, and you check it with no
RootHerald call.

```ts
import { RootHeraldClient, verifyKeySignature } from '@rootherald/node';

// 1. Mint a key challenge for the device that just passed an attest
//    challenge. Relay `keyChallenge` to the client; keep `nonce`.
const { nonce, keyChallenge } = await rh.issueKeyChallenge({
  purpose: 'sign',
  expectedDevices: [result.device.ueid!],
});

// 2. The client's MintKey answers with a `certification` and keeps its key blob.
const key = await rh.certifyKey(nonce, certification);
await db.saveDeviceKey(key.deviceId, key.keyId, key.jwk);

// Later, without any RootHerald call: the client signed `message` with its key
// and sent { message, signature }.
const { jwk } = await db.loadDeviceKey(session.deviceId);
if (!verifyKeySignature(jwk, message, signature)) {
  return res.status(401).end();
}
```

`certifyKey` returns:

```ts
key.deviceId      // string — the alias of the device that holds the key
key.keyId         // string — RootHerald's id for the key
key.purpose       // 'sign' | 'decrypt'
key.alg           // 'ES256' | 'RS256' | 'ECDH-ES' | 'RSA-OAEP-256'
key.format        // 'jwe' | 'apple-ecies' | undefined — decrypt keys only
key.jwk           // { kty: 'EC', crv: 'P-256', x, y } or { kty: 'RSA', n, e }
key.hardwareBound // boolean — false on macOS, where only possession is proved
key.certifiedAt   // Date
```

A signature proves which chip signed, not how the machine booted; run an
attest challenge for that.

Minting again for the same purpose rotates the key under the same `keyId`; a
re-enrolled installation gets new key IDs. The key ID identifies an
installation's credential, never a device: bind accounts to the alias.

`verifyKeySignature(jwk, message, signature)` takes the message as bytes or a
UTF-8 string, and the signature as bytes or a base64url string. ES256: a
64-byte signature is read as IEEE P1363 `r || s`, any other length as DER.
RS256: PKCS#1 v1.5 over SHA-256, exactly the modulus length (256 bytes). It
returns `false` and never throws on malformed input.

## Errors

An un-enrolled or failing device is **not** an error: it comes back as a
normal verdict with a `fail`/`warn` result. Protocol, auth, and budget problems
raise a typed `RootHeraldApiError`:

| Status | `errorCode`          | Error class              |
| ------ | -------------------- | ------------------------ |
| 401    | `activation_refused` | `ActivationRefusedError` |
| 401    | anything else        | `InvalidSecretKeyError`  |
| 400    | `invalid_ask`, `invalid_purpose` | `InvalidAskError` |
| 400    | anything else, including `wire_version_unsupported`, `invalid_enroll_shape`, `invalid_certification` | `InvalidEvidenceError` |
| 409    | `key_rotation_conflict` | `RootHeraldApiError`  |
| 409    | anything else, including `challenge_expired_or_used` | `ChallengeError` |
| 422    | `unknown_policy`     | `UnknownPolicyError`     |
| 422    | `admission_refused`  | `AdmissionRefusedError`  |
| 422    | `expected_unknown`, `key_disclosure_too_low`, `purpose_unsupported`, `certification_rejected` | `RootHeraldApiError` |
| 429    | `budget_exhausted`, or an `X-RootHerald-Quota` header | `QuotaExceededError` (`.budget`) |
| 429    | anything else        | `RateLimitedError`       |

All extend `RootHeraldApiError` (which carries `.status` and the server's
`.errorCode`), which extends `RootHeraldError`. `AdmissionRefusedError.message`
carries the server's detail, which names the TPM class that was refused.
`ActivationRefusedError` is `relayActivate` being refused for an unknown,
spent or foreign `enrollmentId` or a wrong proof; the secret key was accepted.
`InvalidAskError` is a programming error in your backend, not a device
failure. `RateLimitedError.retryAfterSeconds` is the server's `Retry-After`
(else the body's `retryAfterSeconds`, else `undefined`);
`QuotaExceededError.budget` names the budget that refused. Any other status,
and a code no class covers, is a plain `RootHeraldApiError` with `.errorCode`
preserved.

A response whose `verdict.device.verdict` is not `pass`/`warn`/`fail`, whose
timestamps do not parse, or whose certified key is malformed is refused with a
`RootHeraldApiError` of code `INVALID_RESPONSE` rather than returned
half-parsed. A verdict that does not echo the `expectedKey` / `expectedDevices`
you passed to `verify` is refused with code `EXPECTED_NOT_ENFORCED`.

Every request times out after 30 s by default (`timeoutMs` on the client
options); a timeout is a `RootHeraldError` of code `NETWORK_ERROR`. The
default is the same in every RootHerald server SDK.

## The verdict shape

`verify` returns the `AttestationVerdict` with the response-root fields
alongside it. Fields gated by disclosure class are absent below it; the API
key's ceiling (default `pseudonymous`) caps what `requestedDisclosureClass`
can ask for.

```ts
result.acr                 // AcrUrn — satisfied ACR
result.amr                 // AmrValue[] — auth methods (RFC 8176)
result.authTime            // Date
result.expiresAt           // Date
result.userId              // string | undefined
result.requestedAcrValues  // AcrUrn[]
result.expected            // { key?, devices? } | undefined — what the server enforced

result.device.ueid                  // string | undefined — the alias (pseudonymous+)
result.device.disclosureClass       // 'verdict' | 'pseudonymous' | 'derived' | 'full'
result.device.earStatus             // EarStatus
result.device.verdict               // 'pass' | 'warn' | 'fail'
result.device.attestationType       // AttestationType, e.g. 'tpm20'
result.device.attestedAt            // Date
result.device.quoteVerified         // boolean | undefined
result.device.secureBootVerified    // boolean | undefined
result.device.eventLogVerified      // boolean | undefined
result.device.postureEvaluated      // boolean | undefined
result.device.platform              // Platform | undefined
result.device.tpmKind               // 'discrete-tpm' | 'firmware-tpm' | … | undefined
result.device.hardwareGenuine       // boolean | undefined
result.device.sybilResistance       // 'distinct-silicon' | … | undefined
result.device.returningDevice       // boolean | undefined
result.device.bootChanged           // boolean | undefined
result.device.bootChangedStages     // number[] | undefined
result.device.trustworthinessVector // AR4SI vector | undefined

result.assuranceClaimsMet  // string[] | undefined — from the response root
result.enrollmentRequired  // boolean | undefined — from the response root
```

`DeviceVerdict` in `@rootherald/contracts` lists every field. Timestamps
arrive as ISO-8601 strings and are parsed to `Date` objects (`authTime`,
`expiresAt`, `device.attestedAt`, `device.identityFirstSeen`,
`device.bootBaselineAt`, `key.certifiedAt`).

## What this package exports

`RootHeraldClient`, `verifyKeySignature`, the error classes above, the
option/result types (`IssueChallengeOptions`, `AttestOptions`, `AttestResult`,
`IssueKeyChallengeOptions`, `CertifiedKeyResult`), and the contract types from
`@rootherald/contracts` (`Ask`, `ChallengeResponse`, `KeyChallengeResponse`,
`KeyCertification`, `CertifiedKey`, `AkBlob`, `KeyBlob`, `EvidenceBlob`, the
enroll blobs, the verdict types). There is no webhook receiver in this package.
