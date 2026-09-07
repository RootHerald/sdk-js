# @rootherald/node

Server-side SDK for RootHerald device attestation.

**Backend relay (server -> server).** The user's client does local TPM work and
hands your server opaque blobs (no keys, no RootHerald contact). Your server
relays those blobs to RootHerald with `RootHeraldClient`, authenticated by your
`rh_sk_` secret key. The verdict is computed by RootHerald and returned to *your
backend*; it never travels through the client.

**The challenge carries the ask.** What the device is asked to prove is fixed
when you issue the challenge, bound to it server-side, and echoed to the client
inside the `challenge` string. `verify` appraises against that stored ask, so
nothing between the two calls can widen or weaken it.

- `new RootHeraldClient({ secretKey })`: the server client.
- `rh.issueChallenge({ ask?, policy?, keyPurpose?, deviceHint? })`: mint a
  single-use challenge (`POST /api/v1/attest/challenge`). Relay its `challenge`
  string to the client verbatim.
- `rh.verify(evidence, { challengeId, policy?, requestedDisclosureClass? })`:
  submit the client's evidence (`POST /api/v1/attest/verify`); get the verdict,
  plus the certified `key` when one was asked for.
- `rh.relayEnroll(enrollRequestBlob, { challengeId? })`: enroll leg 1
  (`POST /api/v1/attest/enroll`).
- `rh.relayActivate(activationResponse)`: enroll leg 2
  (`POST /api/v1/attest/activate`).
- `verifyKeySignature(jwk, message, signature)`: check a signature from a
  certified key locally, with `node:crypto` only.

## Install

```
pnpm add @rootherald/node
```

`secretKey` is **required** and must start with `rh_sk_`; any other value is
rejected. `baseUrl` defaults to the production RootHerald API and must be
`https` (loopback excepted). Network calls use the built-in `fetch` (Node 18+).
The package has no runtime dependencies beyond `@rootherald/contracts`, which
is types only.

## The three flows

Every flow is the same two calls with a different `ask`. The client side of
each is `respond(challenge)` in `@rootherald/browser` (or the equivalent verb in
another client SDK).

### Identity binding: is this the device I enrolled?

```ts
import { RootHeraldClient } from '@rootherald/node';

const rh = new RootHeraldClient({ secretKey: process.env.RH_SECRET_KEY! }); // rh_sk_…

// 1. Mint a challenge asking for identity, and relay `challenge` to the client.
const { challengeId, challenge } = await rh.issueChallenge({ ask: ['identity'] });

// 2. The client responds with an opaque `evidence` blob. Appraise it.
const result = await rh.verify(evidence, { challengeId });

if (result.device.verdict === 'pass') {
  // result.device.ueid is this tenant's stable id for the TPM: bind the session to it.
}
```

Omitting `ask` asks for `['identity', 'posture']`, which is what a challenge
always asked for before the ask existed.

### Posture step-up: is the boot configuration acceptable right now?

```ts
const { challengeId, challenge } = await rh.issueChallenge({
  ask: ['identity', 'posture'],
  policy: 'rootherald:builtin:strict-hardware',
});
// … relay `challenge`, receive `evidence` …
const result = await rh.verify(evidence, { challengeId });

if (result.device.verdict === 'pass') {
  // allow the high-value action; result.assuranceClaimsMet lists the
  // policy's claims the device satisfied, if you gate on those too
}
```

A `policy` named at `issueChallenge` is bound to the challenge. `verify` may
name a stricter policy but never a weaker one: the API refuses a downgrade with
`PolicyDowngradeError`.

### Key issuance and local verification: give the device a key I can trust

Ask for `'key'` and the device creates a fresh P-256 key inside its TPM and has
the enrolled attestation key certify it. The private half never leaves the TPM
and never reaches RootHerald; the client keeps an opaque `KeyBlob`, you keep
the public JWK.

```ts
import { RootHeraldClient, verifyKeySignature } from '@rootherald/node';

const { challengeId, challenge } = await rh.issueChallenge({
  ask: ['identity', 'key'],
  keyPurpose: 'sign',
});
// … relay `challenge`; the client responds with `evidence` and keeps its `KeyBlob` …
const result = await rh.verify(evidence, { challengeId });

if (result.device.verdict === 'pass' && result.key) {
  await db.saveDeviceKey(result.device.ueid, result.key.keyId, result.key.jwk);
}

// Later, without any RootHerald call: the client signed `message` with its key
// (`sign(keyBlob, message)` in @rootherald/browser) and sent { message, signature }.
const { jwk } = await db.loadDeviceKey(deviceUeid);
if (!verifyKeySignature(jwk, message, signature)) {
  return res.status(401).end();
}
```

`result.key` is present only when the challenge asked for `'key'` **and** the
verdict passed; a failing verdict certifies nothing. Its shape:

```ts
result.key.keyId        // string — RootHerald's id for the key
result.key.jwk          // { kty: 'EC', crv: 'P-256', x, y }
result.key.purpose      // 'sign'
result.key.authPolicy   // string | undefined — base64 authPolicy digest, when set
result.key.certifiedAt  // Date
```

`verifyKeySignature(jwk, message, signature)` takes the message as bytes or a
UTF-8 string, and the signature as bytes or a base64url string. A 64-byte
signature is read as IEEE P1363 `r || s`; any other length as DER. It returns
`false` and never throws on malformed input.

## Enroll a device (backend-relayed, two legs)

A device must enroll once before it can respond to an identity challenge.
Enrollment is a credential-activation handshake: the client produces an
`enrollRequestBlob`, your backend relays it, and relays the client's activation
response back.

```ts
// Leg 1: relay the client's EnrollBegin() blob. Pass a live challengeId to run
// admission against that challenge's policy, so a device that could never
// satisfy it is refused before it gets an attestation key.
const enroll = await rh.relayEnroll(enrollRequestBlob, { challengeId });

// Hand enroll.challenge to the client's EnrollComplete(), which returns an
// activationResponse blob; relay it to finish binding.
const activated = await rh.relayActivate(activationResponse);
// activated.deviceId is the bound device.
```

Every enroll returns a challenge, including for a device already known:
re-enrolment is how a device rotates its attestation key. `deviceId` is this
tenant's alias for the device, not a global identifier.

If your backend wants to try `verify` first and enroll only on a miss, a
response with `enrollmentRequired: true` is the cue.

## Errors

An un-enrolled or failing device is **not** an error: it comes back as a
normal verdict with a `fail`/`warn` result. Protocol, auth, and quota problems
raise a typed `RootHeraldApiError`:

| Status | `errorCode`          | Error class              |
| ------ | -------------------- | ------------------------ |
| 401    |                      | `InvalidSecretKeyError`  |
| 400    |                      | `InvalidEvidenceError`   |
| 409    |                      | `ChallengeError`         |
| 422    | `unknown_policy`     | `UnknownPolicyError`     |
| 422    | `admission_refused`  | `AdmissionRefusedError`  |
| 422    | `policy_downgrade`   | `PolicyDowngradeError`   |
| 429    |                      | `QuotaExceededError`     |

All extend `RootHeraldApiError` (which carries `.status` and the server's
`.errorCode`), which extends `RootHeraldError`. `AdmissionRefusedError.message`
carries the server's detail, which names the TPM class that was refused.

## The verdict shape

`verify` returns the `AttestationVerdict` with the response-root fields
alongside it:

```ts
result.acr                 // AcrUrn — satisfied ACR
result.amr                 // AmrValue[] — auth methods (RFC 8176)
result.authTime            // Date
result.expiresAt           // Date
result.userId              // string — the `sub`
result.requestedAcrValues  // AcrUrn[]

result.device.ueid                  // string — this tenant's device id
result.device.earStatus             // EarStatus
result.device.verdict               // 'pass' | 'warn' | 'fail'
result.device.attestationType       // AttestationType, e.g. 'tpm20'
result.device.attestedAt            // Date
result.device.quoteVerified         // boolean | undefined
result.device.secureBootVerified    // boolean | undefined
result.device.eventLogVerified      // boolean | undefined
result.device.platform              // Platform | undefined
result.device.hardwareModel         // string | undefined
result.device.trustworthinessVector // AR4SI vector | undefined

result.assuranceClaimsMet  // string[] | undefined — from the response root
result.enrollmentRequired  // boolean | undefined — from the response root
result.key                 // certified key | undefined — from the response root
```

Timestamps arrive as ISO-8601 strings and are parsed to `Date` objects
(`authTime`, `expiresAt`, `device.attestedAt`, `key.certifiedAt`).

## Mobile bridge

`rh.verifyMobileEvidence(body)` handles the POST the RootHerald companion app
makes to your registered `appVerifyUrl`, validates the `iosAttestation` shape,
and brokers `verify` with your `rh_sk_`. `buildMobileAttestLink` builds the
link a page opens to hand a challenge to the app.

## What this package exports

`RootHeraldClient`, `verifyKeySignature`, the error classes above, the
option/result types (`IssueChallengeOptions`, `AttestOptions`, `AttestResult`,
`AttestResultKey`, `RelayEnrollOptions`), and the contract types from
`@rootherald/contracts` (`Ask`, `ChallengeResponse`, `CertifiedKey`, `KeyBlob`,
`EvidenceBlob`, the enroll blobs, the verdict types). There is no webhook
receiver in this package.
