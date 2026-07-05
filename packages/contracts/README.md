# @rootherald/contracts

The **shared contract / type layer** for the Root Herald JavaScript SDKs. It is
the single source of truth for the wire shapes and error classes that both the
**client** package (`@rootherald/browser`) and the **server** package
(`@rootherald/node`) build on, so the two halves of an integration stay in sync.

It is almost entirely **types** (no runtime code) apart from the error classes.
You usually don't install it directly: `@rootherald/browser` and
`@rootherald/node` depend on it and re-export the types you need. Pull it in on
its own only when you want to share these types with your own code.

```bash
npm install @rootherald/contracts
```

## What's in here

- **EAT / claim types**: `AttestationTokenClaims`, `RootHeraldDeviceClaims`,
  `AcrUrn`, `EarTrustworthinessVector`, `Platform`, `Verdict`, etc.
- **SDK API types**: `AttestationVerdict`, `DeviceVerdict`, `VerifyOptions`,
  `RequireAttestationMiddlewareOptions`.
- **Background-Check wire types**: `ChallengeRequest` / `ChallengeResponse`,
  `EvidenceBlob`, `VerifyAttestationRequest` / `VerifyAttestationResponse`.
- **Client ABI 2.0 enroll blobs** (client-neutral): `EnrollRequestBlob`,
  `EnrollActivationChallenge`, `EnrollActivationResponse`. The three client
  verbs are Enroll (begin/complete), Attest, and PreCheck; the client holds no
  RootHerald key and opens no socket to RootHerald.
- **Backend relay contract** (server-context, on `/server`): `RelayEnrollRequest`
  / `RelayEnrollResponse` (+ the `409` `AlreadyEnrolledResponse` and the
  normalized `RelayEnrollResult` discriminated union), `RelayActivateRequest` /
  `RelayActivateResponse`, alongside the challenge/verify pair, for the `rh_sk_`
  server SDK helpers. `RelayEnrollResult` is the one shape every server SDK
  returns from its `relayEnroll` helper.
- **Error classes**: split by context (below).

## Errors: client-neutral vs server-context

Not every error belongs in every runtime. The split matters because the
`rh_sk_` secret key and the `/verify` appraisal **only ever live on the
customer's backend**. A browser bundle has no secret and never calls that API.

**Client-neutral** (base / token-verification errors, exported from the root):

- `RootHeraldError`: base class for everything; carries a machine-readable `code`.
- `TokenExpiredError`: a token's `exp` is in the past.
- `InvalidTokenError`: signature / issuer / audience / schema check failed.
- `RootHeraldApiError`: base class for the server-context API errors below.

**Server-context** (Background-Check API failures — raised only on the backend,
on the `rh_sk_` path, via `@rootherald/node` or another server SDK):

- `InvalidSecretKeyError`: the `rh_sk_` secret is missing/malformed/rejected (401).
- `UnknownPolicyError`: the named policy is unknown/foreign (422).
- `QuotaExceededError`: the tenant exceeded its metered verify quota (429).
- `ChallengeError`: the challenge expired or was already used (409).
- `InvalidEvidenceError`: the evidence blob was malformed/unappraisable (400).

Import the server-context errors from the dedicated subpath:

```ts
import { InvalidSecretKeyError, QuotaExceededError } from "@rootherald/contracts/server";
```

> The server-context errors are also re-exported (deprecated) from the package
> root for backwards compatibility. Prefer `@rootherald/contracts/server` in new
> server code.

**Browser apps generally only handle the browser SDK's own errors**
(`ExtensionMissingError`, `HostMissingError`, `TimeoutError` from
`@rootherald/browser`). Verification, the `rh_sk_` secret, and the
server-context errors above are **server-only**. See `@rootherald/node` and the
other server SDKs at [github.com/RootHerald](https://github.com/RootHerald).

## License

MIT. See [LICENSE](../../LICENSE).
