# @rootherald/node

Server-side SDK for Root Herald device attestation.

**Backend relay (server -> server, Client ABI 2.0).** Your dumb client does
local TPM work and hands your server opaque blobs (no keys, no Root Herald
contact). Your server relays those blobs to Root Herald with the `RootHerald`
client, authenticated by your `rh_sk_` secret key. The verdict is computed by
Root Herald and returned to *your backend*; it never travels through the client.

- `new RootHerald({ secretKey })`: the server client.
- `rh.relayEnroll(enrollRequestBlob)`: enroll leg 1 (`POST /devices/enroll`).
  `201` returns the activation `challenge` + `deviceId`; `409` means the device
  is already enrolled (`alreadyEnrolled: true`, `deviceId` only, so skip leg 2).
- `rh.relayActivate(activationResponse)`: enroll leg 2 (`POST /devices/activate`).
- `rh.issueChallenge(opts?)`: mint a relay-friendly nonce.
- `rh.verify(evidence, { challengeId })`: submit evidence, get an
  `AttestationVerdict`.

> `createChallenge` / `attest` remain as deprecated aliases for `issueChallenge`
> / `verify`.

## Install

```
pnpm add @rootherald/node
```

## Enroll a device (backend-relayed, two legs)

Enrollment is a credential-activation handshake. Your client produces an
`enrollRequestBlob`; your backend relays it and (on a fresh enroll) relays the
client's activation response back.

```ts
import { RootHerald } from '@rootherald/node';

const rh = new RootHerald({ secretKey: process.env.RH_SECRET_KEY! }); // rh_sk_…

// Leg 1: relay the client's EnrollBegin() blob.
const enroll = await rh.relayEnroll(enrollRequestBlob);

if (enroll.alreadyEnrolled) {
  // 409: the device is already bound. Just use enroll.deviceId — skip leg 2.
} else {
  // 201: hand enroll.challenge to the client's EnrollComplete(), which returns
  // an activationResponse blob; relay it to finish binding.
  const activated = await rh.relayActivate(activationResponse);
  // activated.deviceId is the bound device.
}
```

## Attest a device server-side

```ts
import { RootHerald } from '@rootherald/node';

const rh = new RootHerald({ secretKey: process.env.RH_SECRET_KEY! }); // rh_sk_…

// 1. Mint a nonce and relay it to your client.
const { challengeId, nonce, expiresAt } = await rh.issueChallenge();

// 2. Your client quotes over `nonce` and returns an opaque `evidence` blob to
//    your server. Submit it for appraisal.
const verdict = await rh.verify(evidence, {
  challengeId,
  policy: 'rootherald:builtin:default', // caller-named policy; fail-closed
});

if (verdict.device.verdict === 'pass') {
  // gate the capability on the verdict returned to your backend.
}
```

`secretKey` is **required** and must start with `rh_sk_`; any other value is
rejected. `baseUrl` defaults to the production Root Herald
API. An un-enrolled or failing device is **not** an error: it comes back as a
normal verdict with a `fail`/`warn` result. Protocol/auth/quota problems raise a
typed `RootHeraldApiError`:

| Status | Error class             |
| ------ | ----------------------- |
| 401    | `InvalidSecretKeyError` |
| 422    | `UnknownPolicyError`    |
| 409    | `ChallengeError`        |
| 400    | `InvalidEvidenceError`  |
| 429    | `QuotaExceededError`    |

All extend `RootHeraldApiError` (which carries `.status` and the server's
`.errorCode`), which extends `RootHeraldError`. Network calls use the built-in
`fetch` (Node 18+).

### The verdict shape

`AttestationVerdict` carries the OIDC top-level claims plus a nested device
verdict:

```ts
verdict.acr            // AcrUrn — satisfied ACR
verdict.amr            // AmrValue[] — auth methods (RFC 8176)
verdict.authTime       // Date — when the user last authenticated
verdict.expiresAt      // Date
verdict.userId         // string — the `sub`
verdict.requestedAcrValues // AcrUrn[]

verdict.device.ueid                 // string — device UUID (NOT `deviceId`)
verdict.device.earStatus            // EarStatus
verdict.device.verdict              // 'pass' | ...
verdict.device.attestationType      // AttestationType, e.g. 'tpm20'
verdict.device.attestedAt           // Date
verdict.device.quoteVerified        // boolean | undefined
verdict.device.secureBootVerified   // boolean | undefined
verdict.device.eventLogVerified     // boolean | undefined
verdict.device.platform             // Platform | undefined
verdict.device.hardwareModel        // string | undefined
verdict.device.trustworthinessVector // AR4SI vector | undefined
```

## What this package exports

The public surface is the `RootHerald` server client (for the backend-relayed
enroll + attest flow: `relayEnroll`, `relayActivate`, `issueChallenge`,
`verify`). There is no webhook receiver in this package.
