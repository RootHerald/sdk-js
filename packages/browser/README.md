# @rootherald/browser

The **page-side** Root Herald SDK (Client ABI 3.0). It orchestrates the
**keyless** client flow over the page → extension → native-host bridge and hands
**opaque blobs** to you (the embedder). Your backend relays those blobs to Root
Herald with its `rh_sk_` secret (see [`@rootherald/node`](https://www.npmjs.com/package/@rootherald/node)).

**The browser holds no Root Herald key and never calls Root Herald.** Every verb
is a local TPM operation on the user's machine; bytes move only over *your own*
client ↔ backend channel, which you own. No secret, no verdict, no Root Herald
network call ever happens in the browser.

```
page (@rootherald/browser) ──▶ extension ──▶ native host (TPM)
        │  opaque blobs                              │
        └────────────────── blobs ◀──────────────────┘
        │
        ▼   relay callbacks you provide
   your backend (@rootherald/node, rh_sk_) ──▶ Root Herald
```

## Install

```bash
npm install @rootherald/browser
```

## The three verbs

| Verb | What it does | Returns |
|---|---|---|
| `enroll(relay)` | One-time device-key bootstrap. Two network legs are relayed by **your** backend. | `{ deviceId, alreadyEnrolled }` |
| `attest(nonce)` | Per-attestation fresh TPM quote over a backend-issued nonce. | opaque `EvidenceBlob` |
| `getClientStatus()` | **PreCheck** — local readiness *signals* (never a verdict). | `ClientStatus` |

### `enroll(relay)` — keyless, backend-relayed

Enrollment is a two-leg credential-activation handshake. The local TPM halves run
on the native host under a single elevation; the **network legs are relayed by
your backend** via the `relay` callbacks you pass in. The browser never POSTs to
Root Herald.

```ts
import { enroll } from '@rootherald/browser';

const { deviceId, alreadyEnrolled } = await enroll({
  // Leg 1: POST the blob to YOUR backend, which calls @rootherald/node
  // `relayEnroll(blob)` and returns its RelayEnrollResult.
  enroll: (enrollRequestBlob) =>
    fetch('/rh/enroll', {
      method: 'POST',
      body: JSON.stringify(enrollRequestBlob),
    }).then((r) => r.json()),

  // Leg 2: POST the activation blob to YOUR backend, which calls
  // @rootherald/node `relayActivate(blob)`. Only called for a fresh enroll.
  activate: (activationBlob) =>
    fetch('/rh/activate', {
      method: 'POST',
      body: JSON.stringify(activationBlob),
    }).then((r) => r.json()),
});
```

`enroll` runs `enroll-begin` → `relay.enroll` → (`enroll-complete` →
`relay.activate`), and is **idempotent**: a device that is already bound makes
your `relay.enroll` resolve with `{ alreadyEnrolled: true, deviceId }`, so the
second TPM leg and `relay.activate` are skipped and you just get the `deviceId`.

> Your backend's `/rh/enroll` and `/rh/activate` handlers are the only place a
> Root Herald key lives. They use `@rootherald/node`'s `relayEnroll` /
> `relayActivate` — see that package for the backend half.

### `attest(nonce)` — per-attestation evidence

```ts
import { attest } from '@rootherald/browser';

// 1. Your backend calls Root Herald /challenge and returns { challengeId, nonce }.
const { challengeId, nonce } = await fetch('/rh/challenge').then((r) => r.json());

// 2. The page collects a fresh TPM quote over the nonce via the extension.
const evidence = await attest(nonce, { challengeId });

// 3. Hand the opaque blob to YOUR backend, which relays it to Root Herald /verify.
const result = await fetch('/rh/verify', {
  method: 'POST',
  body: JSON.stringify({ challengeId, evidence }),
}).then((r) => r.json());
```

Prefer a one-call handoff? Pass a `relay.verify` callback and `attest` resolves
with whatever your backend returns instead of the raw blob (still keyless):

```ts
const result = await attest(nonce, {
  challengeId,
  relay: {
    verify: (evidence) =>
      fetch('/rh/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, evidence }),
      }).then((r) => r.json()),
  },
});
```

> Compositions, not new verbs: **step-up / re-attest** is just `attest` again with
> a fresh nonce; **key rotation** is `enroll` again; **device-bound accounts** are
> your backend mapping the verified `deviceId` to its user.

`attest` and `enroll` throw typed errors so a cold-start UI can route to the right fix:

- `ExtensionMissingError` — the extension is not installed → link the store page.
- `HostMissingError` — extension present, native host unreachable → download + run the installer.
- `TimeoutError` — the operation started but did not finish in time.

`collectEvidence` remains as a deprecated alias of `attest` (evidence-only).

## PreCheck — cold-start detection

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

These are **readiness signals, never a verdict** — they only help you avoid
spending an attestation that will hard-fail.

### How detection works

- **OS / browser** — sniffed from the user-agent. The native host is
  **Windows-first**; `macos`/`linux` resolve `host: 'unsupported'`.
- **Extension presence** — the page posts a `ping`; the extension's content
  script answers only when installed (it never broadcasts unsolicited, so
  non–Root Herald sites can't fingerprint it). A timeout means `missing`.
- **Host reachability** — once the extension is present, a local-only `status`
  request drives the extension's `connectNative` to the host. Success →
  `present`; a disconnect/timeout → `missing` (a distinct state, because it
  routes to a different fix).

## Exports

`enroll`, `attest` (+ `collectEvidence` alias), `getClientStatus`,
`onClientStatusChange`, the detect helpers, the typed errors, the
`ROOTHERALD_EXTENSION_ID` constant, the wire message types/actions, and the
contract blob types (`EvidenceBlob`, `EnrollRequestBlob`,
`EnrollActivationChallenge`, `EnrollActivationResponse`, `RelayEnrollResult`,
`RelayActivateResponse`) re-exported from `@rootherald/contracts`.
