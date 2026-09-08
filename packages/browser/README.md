# @rootherald/browser

The **page-side** RootHerald SDK (Client ABI 6.0). It orchestrates the
**keyless** client flow over the page → extension → native-host bridge and hands
**opaque blobs** to you (the embedder). Your backend relays those blobs to
RootHerald with its `rh_sk_` secret (see [`@rootherald/node`](https://www.npmjs.com/package/@rootherald/node)).

**The browser holds no RootHerald key and never calls RootHerald.** Every verb
is a local TPM operation on the user's machine; bytes move only over *your own*
client ↔ backend channel, which you own. No secret, no verdict, no RootHerald
network call ever happens in the browser.

```
page (@rootherald/browser) ──▶ extension ──▶ native host (TPM)
        │  opaque blobs                              │
        └────────────────── blobs ◀──────────────────┘
        │
        ▼   relay callbacks you provide
   your backend (@rootherald/node, rh_sk_) ──▶ RootHerald
```

## Install

```bash
npm install @rootherald/browser
```

## The verbs

| Verb | What it does | Returns |
|---|---|---|
| `respond(challenge)` | Answer a backend-issued challenge: whatever its ask says (fresh TPM quote, event log, key certification). | `{ evidence, key? }` |
| `sign(key, data)` | Sign with a certified key. The private half stays in the TPM. | `{ alg: 'ES256', signature }` |
| `enroll(relay)` | One-time device-key bootstrap. Two network legs are relayed by **your** backend. | `{ deviceId }` |
| `getClientStatus()` | **PreCheck** — is the extension there, is the host there. | `ClientStatus` |
| `getPosture()` | **PreCheck** — the host's local posture signals. | `DevicePosture` |

PreCheck results are **readiness signals, never a verdict**.

### `respond(challenge)`: the challenge carries the ask

Your backend mints a challenge with `@rootherald/node`'s `issueChallenge`,
naming what the device must prove (`identity`, `posture`, `key`). It relays
the `challenge` string to the page verbatim; the host reads the ask from it.
The page never needs to parse it.

```ts
import { respond } from '@rootherald/browser';

// 1. Your backend calls issueChallenge({ ask: ['identity'] }) and returns
//    { challengeId, challenge }.
const { challengeId, challenge } = await fetch('/rh/challenge').then((r) => r.json());

// 2. The host does what the ask says and returns the opaque evidence.
const { evidence } = await respond(challenge);

// 3. Hand the blob to YOUR backend, which relays it to RootHerald's verify.
const result = await fetch('/rh/verify', {
  method: 'POST',
  body: JSON.stringify({ challengeId, evidence }),
}).then((r) => r.json());
```

Prefer a one-call handoff? Pass a `relay.verify` callback and `respond`
resolves with whatever your backend returns instead of the evidence (still
keyless):

```ts
const result = await respond(challenge, {
  relay: {
    verify: (evidence) =>
      fetch('/rh/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, evidence }),
      }).then((r) => r.json()),
  },
});
```

**Step-up / re-attest** is `respond` again with a fresh challenge whose ask
names `posture`. There is no separate verb.

### `respond` + `sign`: a key the backend can trust

When the ask includes `key`, the host creates a fresh P-256 key inside the
TPM, has the enrolled attestation key certify it, and returns the wrapped key
as an opaque `KeyBlob` alongside the evidence. **The page keeps the blob**; it
is the only handle to the key, it is useless off the TPM that made it, and no
SDK parses it. The backend gets the public JWK from `verify`.

```ts
import { respond, sign } from '@rootherald/browser';

// issueChallenge({ ask: ['identity', 'key'], keyPurpose: 'sign' }) on the backend.
const { challengeId, challenge } = await fetch('/rh/challenge?key=1').then((r) => r.json());

const { evidence, key } = await respond(challenge);
localStorage.setItem('rh-key', key!); // your choice of storage

await fetch('/rh/verify', { method: 'POST', body: JSON.stringify({ challengeId, evidence }) });

// Later — no RootHerald call anywhere. The backend checks the signature with
// @rootherald/node's verifyKeySignature(jwk, message, signature).
const message = `login:${Date.now()}`;
const { signature } = await sign(localStorage.getItem('rh-key')!, message);
await fetch('/rh/login', { method: 'POST', body: JSON.stringify({ message, signature }) });
```

`data` for `sign` is the bytes to sign; a string is UTF-8 text, so the backend
checks `"hello"` with `"hello"`. Pass an existing blob as `respond(challenge,
{ key })` to certify the same key again under a new challenge. With a `relay`,
the key blob is the second argument to `relay.verify(evidence, key)`.

### `enroll(relay)`: keyless, backend-relayed

A device must enroll once before it can answer an identity challenge.
Enrollment is a two-leg credential-activation handshake. The local TPM halves
run on the native host under a single elevation; the **network legs are
relayed by your backend** via the `relay` callbacks you pass in. The browser
never POSTs to RootHerald.

```ts
import { enroll } from '@rootherald/browser';

const { deviceId } = await enroll({
  // Leg 1: POST the blob to YOUR backend, which calls @rootherald/node
  // `relayEnroll(blob, { challengeId? })` and returns its RelayEnrollResult.
  enroll: (enrollRequestBlob) =>
    fetch('/rh/enroll', {
      method: 'POST',
      body: JSON.stringify(enrollRequestBlob),
    }).then((r) => r.json()),

  // Leg 2: POST the activation blob to YOUR backend, which calls
  // @rootherald/node `relayActivate(blob)`.
  activate: (activationBlob) =>
    fetch('/rh/activate', {
      method: 'POST',
      body: JSON.stringify(activationBlob),
    }).then((r) => r.json()),
});
```

`enroll` runs `enroll-begin` → `relay.enroll` → `enroll-complete` →
`relay.activate` and resolves with `{ deviceId }`. It is idempotent: a device
that has enrolled before runs the same two legs again and gets the same
`deviceId`. Re-enrollment is also how a device rotates its attestation key, so
it is never short-circuited. `deviceId` is an internal handle, not the
`ueid` a verdict returns; key your tables on `verdict.device.ueid`.

The **respond-first, enroll-on-miss** pattern: call `respond`, catch
`NotEnrolledError`, run `enroll`, retry `respond`.

> Your backend's `/rh/enroll` and `/rh/activate` handlers are the only place a
> RootHerald key lives. They use `@rootherald/node`'s `relayEnroll` /
> `relayActivate`. See that package for the backend half.

## Errors

Every verb throws typed errors so a UI can route to the right fix:

| Error | Meaning | Fix |
|---|---|---|
| `ExtensionMissingError` | The extension never answered. | Install the extension. |
| `HostMissingError` | Extension present; native host unreachable. | Download and run the host installer. |
| `TimeoutError` | The operation started but did not finish in time. | Retry. |
| `NotEnrolledError` | Host answered: no attestation key yet. | `enroll()`, then retry. |
| `AskUnsupportedError` | Host answered: it cannot do what the ask names. | Issue a challenge with a smaller ask. |
| `KeyUnloadableError` | Host answered: the `KeyBlob` will not load into this TPM. | Get a new `key` challenge; replace the blob. |
| `AbiMismatchError` | Host answered: it speaks a different ABI (or does not know the action). | Update the native host. |
| `HostError` | Host answered with a code this SDK does not name (`.code`). | |

The last five extend `HostError`, which carries the host's stable `code`; all
extend `RootHeraldBrowserError`. The host prefixes its errors with
`rh:<code>:<text>`; `parseHostError` is exported if you want the raw token.

## Timeouts

`respond` 60 s, `sign` 30 s, `getPosture` 30 s, `enroll` 120 s per host leg
(it can block on a UAC prompt), detection probes 1.5 s. All are `timeoutMs`
options.

## PreCheck: cold-start detection

```ts
import { getClientStatus, onClientStatusChange } from '@rootherald/browser';

const status = await getClientStatus();
// { os: 'windows', browser: 'chrome', extension: 'present', host: 'missing' }

// Live-detecting install stepper that auto-advances as pieces appear:
const stop = onClientStatusChange((s) => {
  if (s.host === 'unsupported') showComingSoon();
  else if (s.extension === 'missing') showInstallExtension(s.browser);
  else if (s.host === 'missing') showInstallHost();
  else showReady(); // READY
});
// stop() when the stepper unmounts.
```

- **OS / browser**: sniffed from the user-agent. The native host is
  **Windows-first**; `macos`/`linux` resolve `host: 'unsupported'`.
- **Extension presence**: the page posts a `ping`; the extension's content
  script answers only when installed (it never broadcasts unsolicited, so
  non-RootHerald sites can't fingerprint it). A timeout means `missing`.
- **Host reachability**: once the extension is present, a local-only `status`
  request drives the extension's `connectNative` to the host. Success →
  `present`; a disconnect/timeout → `missing`.
- **Posture**: `getPosture()` returns the host's local signals (its `abi` and
  `host` version, and what it can see about the TPM and boot). Host-defined.

## Exports

`respond`, `sign`, `enroll`, `getPosture`, `getClientStatus`,
`onClientStatusChange`, the detect helpers, `parseHostError`, the typed
errors, the `ROOTHERALD_EXTENSION_ID` constant, the wire message types and
actions (`ACTION_RESPOND`, `ACTION_SIGN`, `ACTION_POSTURE`, `ACTION_STATUS`,
`ACTION_ENROLL_BEGIN`, `ACTION_ENROLL_COMPLETE`, `ACTION_PING`), and the
contract types (`Ask`, `EvidenceBlob`, `KeyBlob`, `EnrollRequestBlob`,
`EnrollActivationChallenge`, `EnrollActivationResponse`, `RelayEnrollResult`,
`RelayActivateResponse`) re-exported from `@rootherald/contracts`.
