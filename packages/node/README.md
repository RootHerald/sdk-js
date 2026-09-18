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
- `rh.issueChallenge({ ask?, keyPurpose?, deviceHint? })`: mint a
  single-use challenge (`POST /api/v1/attest/challenge`). Relay its `challenge`
  string to the client verbatim.
- `rh.verify(evidence, { nonce, requestedDisclosureClass? })`:
  submit the client's evidence (`POST /api/v1/attest/verify`) under the
  challenge's `nonce`; get the verdict, plus the certified `key` when one was
  asked for.
- `rh.relayEnroll(enrollRequestBlob)`: enroll leg 1
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

// 1. Mint a challenge asking for identity. Relay `challenge` to the client;
//    keep `nonce`, the handle you verify under.
const { nonce, challenge } = await rh.issueChallenge({ ask: ['identity'] });

// 2. The client responds with an opaque `evidence` blob. Appraise it.
const result = await rh.verify(evidence, { nonce });

if (result.device.verdict === 'pass') {
  // result.device.ueid is this tenant's stable id for the TPM: bind the session to it.
}
```

Omitting `ask` asks for `['identity', 'posture']`, which is what a challenge
always asked for before the ask existed.

### Posture step-up: is the boot configuration acceptable right now?

```ts
const { nonce, challenge } = await rh.issueChallenge({
  ask: ['identity', 'posture'],
});
// … relay `challenge`, receive `evidence` …
const result = await rh.verify(evidence, { nonce });

if (result.device.verdict === 'pass') {
  // allow the high-value action; result.assuranceClaimsMet lists the
  // policy's claims the device satisfied, if you gate on those too
}
```

Policies bind to your API key, not to calls. The key carries an identity
policy and, on Pro, a posture policy; a posture ask runs under the posture
policy and everything else under the identity policy. The resolved policy is
pinned on the challenge when it is minted. Change what a key enforces from the
dashboard or `PUT /api/v1/admin/api-keys/{id}/policies`; a `policy` field in a
hand-built request body is refused with `400 policy_bound_to_key`.

### Key issuance and local verification: give the device a key I can trust

Ask for `'key'` and the device creates a fresh P-256 key inside its TPM and has
the enrolled attestation key certify it. The private half never leaves the TPM
and never reaches RootHerald; the client keeps an opaque `KeyBlob`, you keep
the public JWK.

```ts
import { RootHeraldClient, verifyKeySignature } from '@rootherald/node';

const { nonce, challenge } = await rh.issueChallenge({
  ask: ['identity', 'key'],
  keyPurpose: 'sign',
});
// … relay `challenge`; the client responds with `evidence` and keeps its `KeyBlob` …
const result = await rh.verify(evidence, { nonce });

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
// Leg 1: relay the client's EnrollBegin() blob verbatim. Admission runs under
// the key's identity policy, so a device that could never satisfy it is
// refused before it gets an attestation key.
const { challenge } = await rh.relayEnroll(enrollRequestBlob);

// Hand `challenge` (the 201 body) to the client's EnrollComplete(), which
// returns an activationResponse blob; relay it to finish binding.
const { deviceId } = await rh.relayActivate(activationResponse);
// deviceId is this tenant's alias for the device. Keep it here; do not send
// it back to the client.
```

Every enroll returns a challenge, including for a device already known:
re-enrollment is how a device rotates its attestation key. The challenge
carries an `enrollmentId` the client echoes back, never a device id; the
device's alias is known only after activation, and only to your backend.
An iOS enrollment has nothing to activate: its `challenge` is `{}` and there
is no second leg.

If your backend wants to try `verify` first and enroll only on a miss, a
response with `enrollmentRequired: true` is the cue.

## Errors

An un-enrolled or failing device is **not** an error: it comes back as a
normal verdict with a `fail`/`warn` result. Protocol, auth, and quota problems
raise a typed `RootHeraldApiError`:

| Status | `errorCode`          | Error class              |
| ------ | -------------------- | ------------------------ |
| 401    | `activation_refused` | `ActivationRefusedError` |
| 401    | anything else        | `InvalidSecretKeyError`  |
| 400    |                      | `InvalidEvidenceError`   |
| 409    |                      | `ChallengeError`         |
| 422    | `unknown_policy`     | `UnknownPolicyError`     |
| 422    | `admission_refused`  | `AdmissionRefusedError`  |
| 429    | `quota_exceeded`, or an `X-RootHerald-Quota` header | `QuotaExceededError` |
| 429    | anything else        | `RateLimitedError`       |

All extend `RootHeraldApiError` (which carries `.status` and the server's
`.errorCode`), which extends `RootHeraldError`. `AdmissionRefusedError.message`
carries the server's detail, which names the TPM class that was refused.
`ActivationRefusedError` is `relayActivate` being refused for an unknown,
spent or foreign `enrollmentId` or a wrong proof; the secret key was accepted.
`RateLimitedError.retryAfterSeconds` is the server's `Retry-After` (else the
body's `retryAfterSeconds`, else `undefined`); `QuotaExceededError` is the
metered billing ceiling. Any other status, and a 422 or 402 carrying a code
no class covers (`posture_not_bound`, `plan_lapsed`), is a plain
`RootHeraldApiError` with `.errorCode` preserved.

A `verify` response whose `verdict.device.verdict` is not `pass`/`warn`/`fail`,
or whose timestamps do not parse, is refused with a `RootHeraldApiError` of
code `INVALID_RESPONSE` rather than returned half-parsed.

Every request times out after 30 s by default (`timeoutMs` on the client
options); a timeout is a `RootHeraldError` of code `NETWORK_ERROR`. The
default is the same in every RootHerald server SDK.

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

`rh.verifyMobileEvidence(body)` handles the POST the RootHerald bridge makes
to your registered `appVerifyUrl`: `{ nonce, evidence: { iosAttestation: {
assertion, keyId } } }`. It validates that shape and brokers `verify` under
the `nonce` with your `rh_sk_`. The enroll leg arrives at your registered
enroll URL as `{ nonce, enrollment }` (`MobileAppEnrollRequest`);
`rh.relayMobileEnrollment(body)` checks that the envelope `nonce` equals the
`nonce` inside `enrollment` and relays it with `relayEnroll`. These two
helpers exist in the Node and Go SDKs only; the other server SDKs relay the
bodies with their `verify` / `relayEnroll` and the backend compares the two
nonces itself. `buildMobileAttestLink({ bridgeBaseUrl,
challenge })` builds the link a page opens to hand a challenge to the app;
pass it the `challenge` string from `issueChallenge` verbatim, and the app
signs over it. The bridge reopens your `returnUrl` with `?nonce=` so the page
knows which result to poll.

## What this package exports

`RootHeraldClient`, `verifyKeySignature`, the error classes above, the
option/result types (`IssueChallengeOptions`, `AttestOptions`, `AttestResult`,
`AttestResultKey`), and the contract types from
`@rootherald/contracts` (`Ask`, `ChallengeResponse`, `CertifiedKey`, `KeyBlob`,
`EvidenceBlob`, the enroll blobs, the verdict types). There is no webhook
receiver in this package.
