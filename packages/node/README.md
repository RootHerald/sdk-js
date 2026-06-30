# @rootherald/node

Server-side SDK for Root Herald device attestation.

There are two integration paths:

**Background-Check (server -> server).** Your dumb client collects an opaque
evidence blob (no keys, no Root Herald contact) and hands it to your server;
your server appraises it with the `RootHerald` client, authenticated by your
`rh_sk_` secret key.

- `new RootHerald({ secretKey })` — the server client.
- `rh.createChallenge(opts?)` — mint a relay-friendly nonce.
- `rh.attest(evidence, { challengeId })` — submit evidence, get an
  `AttestationVerdict` (and an optional signed token).

**Offline / badge tier.** Verify a Root Herald-issued attestation JWT yourself.

- `verifyAttestationToken(token, options)` — verify a Root Herald attestation
  JWT and get back a typed `AttestationVerdict`.
- `requireAttestation(options)` — an Express/Connect-style middleware that
  verifies the bearer token, enforces ACR + freshness, and attaches the verdict
  at `req.attestation` (RFC 9470 step-up challenge on failure).

## Install

```
pnpm add @rootherald/node
```

## Background-Check: appraise a device server-side

```ts
import { RootHerald } from '@rootherald/node';

const rh = new RootHerald({ secretKey: process.env.RH_SECRET_KEY! }); // rh_sk_…

// 1. Mint a nonce and relay it to your client.
const { challengeId, nonce, expiresAt } = await rh.createChallenge();

// 2. Your client quotes over `nonce` and returns an opaque `evidence` blob to
//    your server. Submit it for appraisal.
const verdict = await rh.attest(evidence, {
  challengeId,
  policy: 'rootherald:builtin:default', // caller-named policy; fail-closed
  returnToken: true,                    // opt-in signed EAT (default false)
});

if (verdict.device.verdict === 'pass') {
  // verdict is the same AttestationVerdict shape as the offline path.
  // verdict.token (when returnToken:true) is verifiable with verifyAttestationToken.
}
```

`secretKey` is **required** and must be a secret key (`rh_sk_…`) — a publishable
key (`rh_pk_…`) is rejected. `baseUrl` defaults to the production Root Herald
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

## Verify a token

```ts
import { verifyAttestationToken } from '@rootherald/node';

const verdict = await verifyAttestationToken(token, {
  issuer: 'https://rootherald.example.com',
  audience: 'your-client-id',
});

console.log(verdict.device.ueid);   // device UUID (the EAT `ueid`)
console.log(verdict.device.earStatus);  // 'affirming' | 'warning' | ...
console.log(verdict.acr);           // satisfied ACR URN
console.log(verdict.device.quoteVerified); // boolean
```

By default the JWKS is fetched from `${issuer}/.well-known/jwks.json`. Override
with `jwksUri` if your deployment serves it elsewhere.

### `verifyAttestationToken(token, options)`

| Option            | Type                 | Default                              | Notes |
| ----------------- | -------------------- | ------------------------------------ | ----- |
| `issuer`          | `string`             | _(required)_                         | Expected `iss`. |
| `audience`        | `string \| string[]` | —                                    | Expected `aud` (your client_id). |
| `jwksUri`         | `string`             | `${issuer}/.well-known/jwks.json`    | Override the JWKS URL. |
| `clockTolerance`  | `number`             | `5`                                  | Clock-skew tolerance, seconds. |
| `jwksCacheMs`     | `number`             | `3_600_000`                          | JWKS cache TTL, milliseconds. |

Throws `TokenExpiredError` when `exp` is in the past and `InvalidTokenError`
for any signature / issuer / audience / schema failure. Both extend
`RootHeraldError` (exported, with a `.code`).

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

verdict.raw            // the raw verified JWT claim set
```

## Gate requests with the middleware

```ts
import express from 'express';
import { requireAttestation } from '@rootherald/node';
import type { AttestationVerdict } from '@rootherald/node';

// Type req.attestation once (e.g. in a .d.ts file):
declare global {
  namespace Express {
    interface Request {
      attestation?: AttestationVerdict;
    }
  }
}

const app = express();

// Gate a sensitive endpoint behind a fresh, high-assurance attestation.
app.post(
  '/api/export',
  requireAttestation({
    issuer: 'https://rootherald.example.com',
    audience: 'your-client-id',
    acrValues: ['urn:rootherald:device:high'], // required ACR URN(s)
    maxAgeSeconds: 300,                         // re-attest within 5 minutes
  }),
  (req, res) => {
    // req.attestation is verified, ACR-checked, and fresh.
    res.json({ device: req.attestation!.device.ueid });
  },
);
```

`requireAttestation` takes every `verifyAttestationToken` option plus:

| Option           | Type                                | Notes |
| ---------------- | ----------------------------------- | ----- |
| `acrValues`      | `AcrUrn[]`                          | Accepted if the token's ACR meets the highest in the list. |
| `maxAgeSeconds`  | `number`                            | Reject if `auth_time` is older than this. |
| `tokenExtractor` | `(req) => string \| null`           | Default: `Bearer` token from the `Authorization` header. |
| `onError`        | `(err, req, res) => void`           | Custom error hook. |

On insufficient ACR or stale `auth_time` the middleware responds `401` with an
RFC 9470 `WWW-Authenticate` step-up challenge.

### ACR tracks: device vs. user (security)

`acrValues` is evaluated over **two separate tracks** — a device track
(`device:any` < `device:high`) and a user track (`user:1fa` < `user:2fa` <
`user:phr` < `user:phrh` < `user:phrh:fresh`). The tracks do **not** cross: a
user-track token never satisfies a `device:*` requirement, and a device-track
token never satisfies a `user:*` requirement. A `device:high` requirement is
additionally satisfied only when the verdict carries the device evidence
(`quoteVerified && secureBootVerified && eventLogVerified`).

> **Breaking behavior change in 0.1.0-alpha.7 (security fix).** Earlier versions
> used a single flattened ACR ladder, so a user-track token (e.g. `user:1fa`)
> could wrongly pass a `device:*` gate. Such tokens are now correctly rejected.
> See `CHANGELOG.md`.

## What this package exports

The public surface is the `RootHerald` server client (for the Background-Check
flow), `verifyAttestationToken`, and `requireAttestation`. There is no webhook
receiver in this package.
